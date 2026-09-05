import type { ActivityListItem,BinaryRouteBatch,Dataset,DatasetFileManifest,DatasetManifest,DatasetSource,ExecutionEngine,QueryResult,QueryTab,RouteActivity,SystemResolution,ViewportBounds,ViewportResult } from "./contracts";
import { lodForZoom, RESOLUTION_VERTEX_BUDGETS, type Lod } from "./lod";
import { normalizeSelectionSql } from "./querySql";
import { applySpatialFilterSql } from "./spatialSql";
type Result<T>={id:number;ok:true;value:T}|{id:number;ok:false;error:string};
type WorkerViewportResult=Omit<ViewportResult,"cache">;
type CacheEntry={result:WorkerViewportResult;bytes:number;bounds?:ViewportBounds;lod:Lod};
type WorkerFile={name:string;buffer?:ArrayBuffer;url?:string;bbox?:ViewportBounds;byteSize:number;rowCount:number;rowGroups?:{rowCount:number;bbox:ViewportBounds;vertexSum?:number;cleanVertexSum?:number}[]};
type WorkerRenderLevel={lod:Lod;files:WorkerFile[]};
const MEBIBYTE=1024**2;
const VIEWPORT_PREFETCH_FRACTION=0.2;
function perf(event:string,fields:Record<string,unknown>){console.info("[squiggles:perf]",event,fields);}
function rawError(error:unknown){return error instanceof Error?error.message:String(error);}
function requestOperation(type:unknown){return ({open:"register Parquet files and create activity_source view",execute:"execute selection SQL",render:"render viewport",summary:"summarize selection",table:"list activities",activity:"load activity detail"} as Record<string,string>)[String(type)]??"DuckDB worker request";}
export function formatDuckDBDiagnostic(body:object,error:unknown,extra:Record<string,unknown>={}):string{
  const request=body as Record<string,unknown>;
  const lines=["Squiggles DuckDB failure",`Request: ${String(request.type??"unknown")}`,`Operation: ${String(extra.operation??requestOperation(request.type))}`];
  if(extra.dataset)lines.push(`Dataset: ${String(extra.dataset)}`);
  if(extra.schemaVersion)lines.push(`Schema: ${String(extra.schemaVersion)}`);
  if(typeof request.clean==="boolean")lines.push(`Clean geometry: ${request.clean}`);
  if(typeof request.lod==="number")lines.push(`LOD: ${request.lod}`);
  if(typeof request.budget==="number")lines.push(`Vertex budget: ${request.budget}`);
  if(Array.isArray(request.bounds))lines.push(`Bounds: ${request.bounds.join(", ")}`);
  const files=Array.isArray(extra.files)?extra.files.map(String):[];
  if(files.length){
    lines.push("",`Files (${files.length}):`,...files.slice(0,20).map(file=>`- ${file}`));
    if(files.length>20)lines.push(`- … ${files.length-20} more`);
  }
  if(typeof request.sql==="string")lines.push("","SQL:",request.sql);
  lines.push("","DuckDB error:",rawError(error));
  return lines.join("\n");
}
export class BrowserDuckDBEngine implements ExecutionEngine {
  private worker=new Worker(new URL("./duckdb.worker.ts",import.meta.url),{type:"module"}); private id=0; private clean=false; private pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void}>();
  private datasetRevision=0; private selectionKey=""; private cache=new Map<string,CacheEntry>(); private cacheBytes=0; private cacheEvictions=0;
  private resolution:SystemResolution="medium"; private consumedPublishedLods=new Set<string>();
  private get cacheBudget(){return cacheBudget(this.resolution);}
  constructor(){this.worker.onmessage=(event:MessageEvent<Result<unknown>>)=>{const call=this.pending.get(event.data.id);if(!call)return;this.pending.delete(event.data.id);if(event.data.ok)call.resolve(event.data.value);else call.reject(new Error(event.data.error));};}
  setResolution(resolution:SystemResolution){if(this.resolution===resolution)return;this.resolution=resolution;this.cache.clear();this.cacheBytes=0;}
  private request<T>(body:object,transfer:Transferable[]=[]):Promise<T>{const id=++this.id;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve:resolve as (value:unknown)=>void,reject});this.worker.postMessage({id,...body},transfer);});}
  private async networkRequest<T>(body:object):Promise<T>{for(let attempt=0;;attempt+=1)try{return await this.request<T>(body);}catch(error){if(attempt<2&&isTransientNetworkError(error)){perf("network-retry",{attempt:attempt+1,error:rawError(error)});await new Promise(resolve=>setTimeout(resolve,250*2**attempt));continue;}throw new Error(formatDuckDBDiagnostic(body,error));}}
  private requestedLod(zoom:number){return lodForZoom(zoom);}
  private initialPlan(tab:QueryTab,zoom:number){
    if(tab.startingLod!=null&&!this.consumedPublishedLods.has(tab.id)){
      this.consumedPublishedLods.add(tab.id);
      return {lod:tab.startingLod,startingVertexEstimate:tab.startingVertexEstimate};
    }
    return {lod:this.requestedLod(zoom),startingVertexEstimate:undefined};
  }
  private cacheKey(zoom:number,bounds:ViewportBounds|undefined){return `${this.selectionKey}|${this.requestedLod(zoom)}|${bounds?.map(value=>value.toFixed(6)).join(",")??"all"}`;}
  private cacheResult(result:WorkerViewportResult,key:string,hit:boolean,bounds:ViewportBounds|undefined,zoom:number):ViewportResult{
    if(!hit&&!this.cache.has(key)){
      const bytes=binaryBytes(result.batches);
      if(bytes<=this.cacheBudget){
        const lod=this.requestedLod(zoom);
        for(const [cachedKey,entry] of this.cache)if(entry.lod===lod&&bounds&&entry.bounds&&boundsContains(bounds,entry.bounds)){this.cache.delete(cachedKey);this.cacheBytes-=entry.bytes;}
        this.cache.set(key,{result,bytes,bounds,lod});this.cacheBytes+=bytes;
        while(this.cacheBytes>this.cacheBudget&&this.cache.size>1){const oldest=this.cache.entries().next().value as [string,CacheEntry]|undefined;if(!oldest)break;this.cache.delete(oldest[0]);this.cacheBytes-=oldest[1].bytes;this.cacheEvictions+=1;}
      }
    }
    return {...result,cache:{hit,bytes:this.cacheBytes,budgetBytes:this.cacheBudget,entries:this.cache.size,evictions:this.cacheEvictions}};
  }
  private cached(key:string,bounds:ViewportBounds,zoom:number):ViewportResult|undefined{let matchedKey=key;let entry=this.cache.get(key);if(!entry){const lod=this.requestedLod(zoom);for(const [candidateKey,candidate] of this.cache)if(candidate.lod===lod&&candidate.bounds&&boundsContains(candidate.bounds,bounds)){matchedKey=candidateKey;entry=candidate;break;}}if(!entry)return undefined;this.cache.delete(matchedKey);this.cache.set(matchedKey,entry);return this.cacheResult(entry.result,matchedKey,true,bounds,zoom);}
  async openDataset(source:DatasetSource,onProgress?: (completed:number,total:number)=>void):Promise<Dataset>{
    const started=performance.now();
    this.datasetRevision+=1;this.selectionKey="";this.cache.clear();this.cacheBytes=0;this.cacheEvictions=0;this.consumedPublishedLods.clear();
    const manifestStarted=performance.now();
    const manifest=source.kind==="directory"
      ? JSON.parse(await(await(await source.handle.getFileHandle("dataset.json")).getFile()).text()) as DatasetManifest
      : await fetch(`${source.baseUrl}/dataset.json`).then(response=>{if(!response.ok)throw new Error(`Could not load dataset manifest (${response.status})`);return response.json() as Promise<DatasetManifest>;});
    const manifestMs=performance.now()-manifestStarted;
    if(!["1.0.0","1.1.0","1.2.0","1.3.0","1.4.0"].includes(manifest.schema_version))throw new Error(`Unsupported dataset schema ${manifest.schema_version}`);
    const files:WorkerFile[]=[];const renderLevels:WorkerRenderLevel[]=[];
    const workerFile=(entry:DatasetFileManifest,buffer?:ArrayBuffer):WorkerFile=>({name:entry.path,...(buffer?{buffer}:{url:source.kind==="url"?`${source.baseUrl}/${entry.path}`:undefined}),bbox:entry.bbox,byteSize:entry.byte_size,rowCount:entry.row_count,rowGroups:entry.row_groups?.map(group=>({rowCount:group.row_count,bbox:group.bbox,vertexSum:group.vertex_count?.sum,cleanVertexSum:group.clean_vertex_count?.sum}))});
    const renderEntries=(manifest.render_levels??[]).flatMap(level=>level.files.map(file=>({lod:level.lod,file})));
    const totalEntries=manifest.shards.length+renderEntries.length;
    if(source.kind==="url"){
      for(const shard of manifest.shards)files.push(workerFile(shard));
      for(const level of manifest.render_levels??[])renderLevels.push({lod:level.lod,files:level.files.map(file=>workerFile(file))});
      onProgress?.(totalEntries,totalEntries);
    }else{
      let completed=0;
      const load=async(entry:DatasetFileManifest)=>{let directory=source.handle;const parts=entry.path.split("/");for(const part of parts.slice(0,-1))directory=await directory.getDirectoryHandle(part);const buffer=await(await(await directory.getFileHandle(parts.at(-1)!)).getFile()).arrayBuffer();onProgress?.(++completed,totalEntries);return workerFile(entry,buffer);};
      for(const shard of manifest.shards)files.push(await load(shard));
      for(const level of manifest.render_levels??[]){const levelFiles:WorkerFile[]=[];for(const entry of level.files)levelFiles.push(await load(entry));renderLevels.push({lod:level.lod,files:levelFiles});}
    }
    const workerStarted=performance.now();
    const name=source.kind==="directory"?source.handle.name:source.name;
    const allRenderFiles=renderLevels.flatMap(level=>level.files);
    const openRequest={type:"open",files,renderLevels,schemaVersion:manifest.schema_version};
    try{await this.request(openRequest,[...files,...allRenderFiles].flatMap(file=>file.buffer?[file.buffer]:[]));}
    catch(error){throw new Error(formatDuckDBDiagnostic(openRequest,error,{dataset:name,schemaVersion:manifest.schema_version,files:[...files.map(file=>file.name),...allRenderFiles.map(file=>file.name)]}));}
    const workerOpenMs=performance.now()-workerStarted;
    perf("dataset-open",{dataset:name,totalMs:Math.round(performance.now()-started),manifestMs:Math.round(manifestMs),workerOpenMs:Math.round(workerOpenMs),shards:files.length,renderLevels:renderLevels.length,renderFiles:allRenderFiles.length,activityCount:manifest.activity_count});
    return{id:name,name,manifest};
  }
  async execute(tab:QueryTab,zoom:number,bounds?:ViewportBounds):Promise<QueryResult&ViewportResult>{
    const started=performance.now();
    const nextClean=tab.style.cleanEnabled;
    const baseSql=normalizeSelectionSql(tab.sql);
    const sql=applySpatialFilterSql(baseSql,tab.spatialFilter);
    const plan=this.initialPlan(tab,zoom);
    const result=await this.networkRequest<QueryResult&WorkerViewportResult>({type:"execute",sql,lod:plan.lod,budget:RESOLUTION_VERTEX_BUDGETS[this.resolution],bounds,clean:nextClean,startingVertexEstimate:plan.startingVertexEstimate});
    this.clean=nextClean;this.selectionKey=`${this.datasetRevision}|${this.clean?1:0}|${sql}`;
    perf("selection-execute",{totalMs:Math.round(performance.now()-started),zoom:Number(zoom.toFixed(2)),requestedLod:plan.lod,plannedLod:result.lod,selected:result.summary.activityCount,rendered:result.activityCount,vertices:result.vertexCount,geometryBytes:result.geometryBufferBytes,candidateBytes:result.scan.candidateBytes,expectedRowGroups:result.scan.expectedRowGroupCount});
    return {...result,...this.cacheResult(result,this.cacheKey(zoom,bounds),false,bounds,zoom)};
  }
  async renderViewport(zoom:number,bounds:ViewportBounds):Promise<ViewportResult>{
    const requestedKey=this.cacheKey(zoom,bounds);const cached=this.cached(requestedKey,bounds,zoom);if(cached){perf("viewport-cache-hit",{zoom:Number(zoom.toFixed(2)),lod:cached.lod,vertices:cached.vertexCount});return cached;}
    const fetchBounds=padViewportBounds(bounds,VIEWPORT_PREFETCH_FRACTION);
    const started=performance.now();
    const requestedLod=this.requestedLod(zoom);
    const result=await this.networkRequest<WorkerViewportResult>({type:"render",lod:requestedLod,budget:RESOLUTION_VERTEX_BUDGETS[this.resolution],bounds:fetchBounds,clean:this.clean});
    perf("viewport-fetch",{totalMs:Math.round(performance.now()-started),zoom:Number(zoom.toFixed(2)),requestedLod,plannedLod:result.lod,vertices:result.vertexCount,geometryBytes:result.geometryBufferBytes,candidateBytes:result.scan.candidateBytes,expectedRowGroups:result.scan.expectedRowGroupCount,prefetchFraction:VIEWPORT_PREFETCH_FRACTION});
    return this.cacheResult(result,this.cacheKey(zoom,fetchBounds),false,fetchBounds,zoom);
  }
  getSummary(bounds?:ViewportBounds):Promise<import("./contracts").SummaryStats>{return this.networkRequest({type:"summary",bounds,clean:this.clean});}
  getActivities(bounds?:ViewportBounds):Promise<ActivityListItem[]>{return this.networkRequest({type:"table",bounds,clean:this.clean});}
  getActivity(activityId:string):Promise<RouteActivity|null>{return this.networkRequest({type:"activity",activityId,clean:this.clean});}
}

export function padViewportBounds(bounds:ViewportBounds,fraction=VIEWPORT_PREFETCH_FRACTION):ViewportBounds{
  const [west,south,east,north]=bounds;
  if(west>east)return bounds;
  const longitudePadding=(east-west)*fraction;
  const latitudePadding=(north-south)*fraction;
  return [Math.max(-180,west-longitudePadding),Math.max(-85,south-latitudePadding),Math.min(180,east+longitudePadding),Math.min(85,north+latitudePadding)];
}

function binaryBytes(batches:BinaryRouteBatch[]):number{
  const buffers=new Set<ArrayBufferLike>();
  for(const batch of batches)for(const array of [batch.positions,batch.startIndices,batch.segmentActivityIndices])buffers.add(array.buffer);
  return [...buffers].reduce((total,buffer)=>total+buffer.byteLength,0);
}

function boundsContains(outer:ViewportBounds,inner:ViewportBounds):boolean{return outer[0]<=outer[2]&&inner[0]<=inner[2]&&outer[0]<=inner[0]&&outer[1]<=inner[1]&&outer[2]>=inner[2]&&outer[3]>=inner[3];}

export function cacheBudget(resolution:SystemResolution="medium"):number{return ({low:128,medium:256,high:512} as const)[resolution]*MEBIBYTE;}

function isTransientNetworkError(error:unknown):boolean{return error instanceof Error&&/(NetworkError|Failed to load|XMLHttpRequest)/i.test(error.message);}
