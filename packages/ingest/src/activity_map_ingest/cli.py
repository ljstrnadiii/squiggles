from __future__ import annotations

import argparse
import json
from pathlib import Path

from .compiler import CompileOptions, compile_strava, validate_dataset


def main() -> int:
    parser = argparse.ArgumentParser(prog="squiggles")
    commands = parser.add_subparsers(dest="command", required=True)
    compile_parser = commands.add_parser("compile-strava")
    compile_parser.add_argument("input", type=Path)
    compile_parser.add_argument("--output", required=True, type=Path)
    compile_parser.add_argument("--overwrite", action="store_true")
    compile_parser.add_argument("--batch-size", type=int, default=16)
    compile_parser.add_argument("--num-cpus", type=int)
    compile_parser.add_argument("--max-rejections", type=int)
    compile_parser.add_argument("--max-rejection-rate", type=float)
    compile_parser.add_argument("--target-shard-rows", type=int, default=512)
    compile_parser.add_argument("--row-group-rows", type=int, default=128)
    validate_parser = commands.add_parser("validate")
    validate_parser.add_argument("dataset", type=Path)
    args = parser.parse_args()
    if args.command == "compile-strava":
        result = compile_strava(
            CompileOptions(
                input_path=args.input,
                output_path=args.output,
                overwrite=args.overwrite,
                batch_size=args.batch_size,
                num_cpus=args.num_cpus,
                max_rejections=args.max_rejections,
                max_rejection_rate=args.max_rejection_rate,
                target_shard_rows=args.target_shard_rows,
                row_group_rows=args.row_group_rows,
            )
        )
    else:
        result = validate_dataset(args.dataset)
    print(
        json.dumps(
            {
                "activity_count": result["activity_count"],
                "rejection_count": result["rejection_count"],
            }
        )
    )
    return 0
