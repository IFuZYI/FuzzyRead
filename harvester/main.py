# -*- coding: utf-8 -*-
"""
main.py: 多站自适应综合控制面板入口
已确保全文本纯净输出，无任何非标特殊符号
"""

import argparse
import sys
from datetime import datetime
from downloader import BBCResourceDownloader
import config


def parse_cli_args():
    """解析命令行参数"""
    current_year = datetime.now().year
    parser = argparse.ArgumentParser(description="多轨多站自愈式外刊内容资产收割底座")
    
    parser.add_argument(
        "--mode", 
        type=str, 
        choices=["latest", "history", "retry"], 
        help="指定运行模式: latest(最新增量), history(历史区间), retry(修复失败节点)"
    )
    
    parser.add_argument(
        "--feeds", 
        nargs="+", 
        help="指定需要的专栏标识符"
    )
    
    parser.add_argument("--start", type=int, default=2020, help="历史模式起始年份")
    parser.add_argument("--end", type=int, default=current_year, help="历史模式结束年份")
    
    return parser.parse_args()


def show_interactive_menu():
    """终端交互主菜单"""
    current_year = datetime.now().year
    print("==================================================")
    print("        多轨多站自愈式外刊内容资产收割底座         ")
    print("==================================================")
    print(" [1] 日常最新增量分类同步 (Latest Mode)")
    print(" [2] 历史区间全量分类收割 (History Mode)")
    print(" [3] 各外刊失败节点定点重试 (Retry Mode)")
    print(" [4] 退出程序")
    print("==================================================")
    
    try:
        choice = input("请选择要执行的任务序列号 [1-4]: ").strip()
        if choice == "1":
            return "latest", 2020, current_year
        elif choice == "2":
            print("\n配置历史区间年份卡尺（按回车保持默认）:")
            start_input = input("  请输入起始年份 (默认 2020): ").strip()
            end_input = input(f"  请输入结束年份 (默认 {current_year}): ").strip()
            start_year = int(start_input) if start_input.isdigit() else 2020
            max_year = int(end_input) if end_input.isdigit() else current_year
            return "history", start_year, max_year
        elif choice == "3":
            return "retry", 2020, current_year
        else:
            print("程序安全退出")
            sys.exit(0)
    except (KeyboardInterrupt, SystemExit):
        print("\n程序安全退出")
        sys.exit(0)


def select_feeds_interactively():
    """终端自适应订阅源矩阵选品页"""
    print("\n当前全站配置中可用的中英文外刊订阅矩阵:")
    feed_keys = list(config.RSS_FEEDS.keys())
    for index, key in enumerate(feed_keys):
        print(f" [{index + 1}] {key}")
    print(" [0] 全选所有站点版块")
    print("==================================================")
    
    try:
        user_input = input("请选择需要的版块序号 (多个请用空格隔开): ").strip()
        if not user_input or user_input == "0":
            return None
            
        chosen_keys = []
        indices = user_input.split()
        for idx in indices:
            if idx.isdigit():
                idx_num = int(idx) - 1
                if 0 <= idx_num < len(feed_keys):
                    chosen_keys.append(feed_keys[idx_num])
                    
        return chosen_keys if chosen_keys else None
    except Exception:
        return None


def main():
    engine = BBCResourceDownloader()
    args = parse_cli_args()
    
    if args.mode:
        mode = args.mode
        target_feeds = args.feeds
        start_year = args.start
        end_year = args.end
        print(f"多站参数解析成功: 正在启动自动化命令行任务 -> {mode.upper()}")
    else:
        mode, start_year, end_year = show_interactive_menu()
        if mode in ["latest", "history"]:
            target_feeds = select_feeds_interactively()
        else:
            target_feeds = None

    if mode == "latest":
        engine.sync_latest(target_keys=target_feeds)
    elif mode == "history":
        engine.download_history(
            target_keys=target_feeds, 
            start_year=start_year, 
            end_year=end_year
        )
    elif mode == "retry":
        engine.retry_failed_snapshots(target_keys=target_feeds)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n用户手动终止，安全退出")
        sys.exit(0)