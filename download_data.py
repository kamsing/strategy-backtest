import yfinance as yf
import json
from datetime import datetime
import os
import sys

# 尝试读取系统代理环境变量
http_proxy = os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy")
https_proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")

if not http_proxy and not https_proxy:
    print("⚠️ 警告: 未检测到系统代理 (HTTP_PROXY/HTTPS_PROXY)。如果您在中国大陆，可能无法访问 Yahoo Finance。")
    print("建议先在终端执行类似: set HTTP_PROXY=http://127.0.0.1:7890 的命令设置代理。")
    print("-" * 50)

def download_ticker(symbol):
    print(f"正在下载 {symbol} 的历史数据...")
    try:
        ticker = yf.Ticker(symbol)
        # 获取最长历史数据
        hist = ticker.history(period="max")
        if hist.empty:
            print(f"❌ {symbol} 下载失败: 获取到的数据为空")
            return None
            
        result = []
        for index, row in hist.iterrows():
            date_str = index.strftime("%Y-%m-%d")
            result.append({
                "date": date_str,
                "low": round(float(row['Low']), 4),
                "close": round(float(row['Close']), 4)
            })
            
        print(f"✅ {symbol} 下载成功，共 {len(result)} 条每日数据。")
        return result
    except Exception as e:
        print(f"❌ {symbol} 下载报错: {str(e)}")
        return None

def main():
    symbols = ['QQQ', 'QLD', 'TQQQ']
    if len(sys.argv) > 1:
        symbols = [s.upper() for s in sys.argv[1:]]

    all_data = {}
    success_count = 0

    for sym in symbols:
        data = download_ticker(sym)
        if data:
            # 兼容 localStorage 的键名格式
            key = f"ticker_daily_cache_v2_{sym}"
            all_data[key] = data
            success_count += 1

    if success_count > 0:
        output_file = "backtest_data_backup.json"
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(all_data, f, indent=2)
        print("-" * 50)
        print(f"🎉 全部完成！已成功下载 {success_count} 个标的。")
        print(f"数据已保存至当前目录下的: {output_file}")
        print("👉 请在网页的“数据管理”面板中，点击【恢复】按钮上传此 JSON 文件即可！")
    else:
        print("-" * 50)
        print("❌ 所有下载均失败，未生成备份文件。请检查代理设置。")

if __name__ == "__main__":
    main()
