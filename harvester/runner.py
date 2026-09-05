import argparse
import json
import sys
from contextlib import redirect_stdout, redirect_stderr
from io import StringIO

from downloader import BBCResourceDownloader


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', required=True, choices=['latest', 'history', 'retry'])
    parser.add_argument('--feeds', nargs='*')
    parser.add_argument('--start', type=int, default=2020)
    parser.add_argument('--end', type=int)
    args = parser.parse_args()

    output = StringIO()
    exit_code = 0
    try:
        engine = BBCResourceDownloader()
        with redirect_stdout(output), redirect_stderr(output):
            if args.mode == 'latest':
                engine.sync_latest(target_keys=args.feeds)
            elif args.mode == 'history':
                engine.download_history(target_keys=args.feeds, start_year=args.start, end_year=args.end)
            else:
                engine.retry_failed_snapshots(target_keys=args.feeds)
    except Exception as exc:
        print(json.dumps({'ok': False, 'error': str(exc), 'output': output.getvalue()}, ensure_ascii=False))
        return 1

    print(json.dumps({'ok': True, 'mode': args.mode, 'output': output.getvalue()}, ensure_ascii=False))
    return exit_code


if __name__ == '__main__':
    sys.exit(main())
