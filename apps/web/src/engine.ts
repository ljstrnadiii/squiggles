import type { ActivityListItem,BinaryRouteBatch,Dataset,DatasetManifest,DatasetSource,ExecutionEngine,QueryResult,QueryTab,RouteActivity,ViewportBounds,ViewportResult } from "./contracts";
type Result<T>={id:number;ok:true;value:T}|{id:number;ok:false;error:string};
type WorkerViewportResult=Omit<ViewportResult,"cache">;
type CacheEntry={result:WorkerViewportResult;bytes:number};
const MEBIBYTE=1024**2;
export class BrowserDuckDBEngine implements ExecutionEngine {
  private worker=new Worker(new URL("./duckdb.worker.ts",import.meta.url),{type:"module"}); private id=0; private clean=false; private pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void}>();
  private datasetRevision=0; private selectionKey=""; private cache=new Map<string,CacheEntry>(); private cacheBytes=0; private cacheEvictions=0;
  private readonly cacheBudget=cacheBudget();
  constructor(){this.worker.onmessage=(event:MessageEvent<Result<unknown>>)=>{const call=this.pending.get(event.data.id);if(!call)return;this.pending.delete(event.data.id);if(event.data.ok)call.resolve(event.data.value);else call.reject(new Error(event.data.error));};}
  private request<T>(body:object,transfer:Transferable[]=[]):Promise<T>{const id=++this.id;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve:resolve as (value:unknown)=>void,reject});this.worker.postMessage({id,...body},transfer);});}
  private cacheKey(zoom:number,bounds:ViewportBounds|undefined){return `${this.selectionKey}|${lodForZoom(zoom)}|${bounds?.map(value=>value.toFixed(6)).join(",")??"all"}`;}
  private cacheResult(result:WorkerViewportResult,key:string,hit:boolean):ViewportResult{
    if(!hit&&!this.cache.has(key)){
      const bytes=binaryBytes(result.batches);
      if(bytes<=this.cacheBudget){
        this.cache.set(key,{result,bytes});this.cacheBytes+=bytes;
        while(this.cacheBytes>this.cacheBudget&&this.cache.size>1){const oldest=this.cache.entries().next().value as [string,CacheEntry]|undefined;if(!oldest)break;this.cache.delete(oldest[0]);this.cacheBytes-=oldest[1].bytes;this.cacheEvictions+=1;}
      }
    }
    return {...result,cache:{hit,bytes:this.cacheBytes,budgetBytes:this.cacheBudget,entries:this.cache.size,evictions:this.cacheEvictions}};
  }
  private cached(key:string):ViewportResult|undefined{const entry=this.cache.get(key);if(!entry)return undefined;this.cache.delete(key);this.cache.set(key,entry);return this.cacheResult(entry.result,key,true);}
  async openDataset(source:DatasetSource,onProgress?: (completed:number,total:number)=>void):Promise<Dataset>{
    this.datasetRevision+=1;this.selectionKey="";this.cache.clear();this.cacheBytes=0;this.cacheEvictions=0;
    const manifest=source.kind==="directory"
      ? JSON.parse(await(await(await source.handle.getFileHandle("dataset.json")).getFile()).text()) as DatasetManifest
      : await fetch(`${source.baseUrl}/dataset.json`).then(response=>{if(!response.ok)throw new Error(`Could not load dataset manifest (${response.status})`);return response.json() as Promise<DatasetManifest>;});
    if(!["1.0.0","1.1.0","1.2.0","1.3.0"].includes(manifest.schema_version))throw new Error(`Unsupported dataset schema ${manifest.schema_version}`);
    const files:{name:string;buffer?:ArrayBuffer;url?:string;bbox?:ViewportBounds;byteSize:number;rowCount:number;rowGroups?:{rowCount:number;bbox:ViewportBounds}[]}[]=[];
    if(source.kind==="url"){
      for(const shard of manifest.shards)files.push({name:shard.path,url:`${source.baseUrl}/${shard.path}`,bbox:shard.bbox,byteSize:shard.byte_size,rowCount:shard.row_count,rowGroups:shard.row_groups?.map(group=>({rowCount:group.row_count,bbox:group.bbox}))});
      onProgress?.(manifest.shards.length,manifest.shards.length);
    }else{
      let completed=0;
      for(const shard of manifest.shards){let directory=source.handle;const parts=shard.path.split("/");for(const part of parts.slice(0,-1))directory=await directory.getDirectoryHandle(part);const buffer=await(await(await directory.getFileHandle(parts.at(-1)!)).getFile()).arrayBuffer();files.push({name:shard.path,buffer,bbox:shard.bbox,byteSize:shard.byte_size,rowCount:shard.row_count,rowGroups:shard.row_groups?.map(group=>({rowCount:group.row_count,bbox:group.bbox}))});onProgress?.(++completed,manifest.shards.length);}
    }
    await this.request({type:"open",files,schemaVersion:manifest.schema_version},files.flatMap(file=>file.buffer?[file.buffer]:[]));
    const name=source.kind==="directory"?source.handle.name:source.name;
    return{id:name,name,manifest};
  }
  async execute(tab:QueryTab,zoom:number,bounds?:ViewportBounds):Promise<QueryResult&ViewportResult>{
    const nextClean=tab.style.cleanEnabled;
    const result=await this.request<QueryResult&WorkerViewportResult>({type:"execute",sql:tab.sql,lod:lodForZoom(zoom),bounds,clean:nextClean});
    this.clean=nextClean;this.selectionKey=`${this.datasetRevision}|${this.clean?1:0}|${tab.sql}`;
    return {...result,...this.cacheResult(result,this.cacheKey(zoom,bounds),false)};
  }
  async renderViewport(zoom:number,bounds:ViewportBounds):Promise<ViewportResult>{
    const key=this.cacheKey(zoom,bounds);const cached=this.cached(key);if(cached)return cached;
    const result=await this.request<WorkerViewportResult>({type:"render",lod:lodForZoom(zoom),bounds,clean:this.clean});
    return this.cacheResult(result,key,false);
  }
  getSummary(bounds?:ViewportBounds):Promise<import("./contracts").SummaryStats>{return this.request({type:"summary",bounds,clean:this.clean});}
  getActivities(bounds?:ViewportBounds):Promise<ActivityListItem[]>{return this.request({type:"table",bounds,clean:this.clean});}
  getActivity(activityId:string):Promise<RouteActivity|null>{return this.request({type:"activity",activityId,clean:this.clean});}
}

function lodForZoom(zoom:number):0|1|2|3|4{return zoom<6?0:zoom<10?1:zoom<13?2:zoom<14?3:4;}

function binaryBytes(batches:BinaryRouteBatch[]):number{
  const buffers=new Set<ArrayBufferLike>();
  for(const batch of batches)for(const array of [batch.positions,batch.startIndices,batch.segmentActivityIndices])buffers.add(array.buffer);
  return [...buffers].reduce((total,buffer)=>total+buffer.byteLength,0);
}

function cacheBudget():number{
  const memory=(navigator as Navigator&{deviceMemory?:number}).deviceMemory;
  return Math.min(1024*MEBIBYTE,Math.max(256*MEBIBYTE,(memory??8)*128*MEBIBYTE));
}
