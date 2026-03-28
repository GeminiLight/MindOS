#!/usr/bin/env bash
# 一键启动 4 个 tmux session，每个在当前目录下执行 source ~/.bashrc

DIR="$(cd "$(dirname "$0")" && pwd)"

sessions=(mos_algo mos_app mos_dev mos_ux)

for s in "${sessions[@]}"; do
  if tmux has-session -t "$s" 2>/dev/null; then
    echo "session '$s' already exists, skipping"
  else
    tmux new-session -d -s "$s" -c "$DIR"
    tmux send-keys -t "$s" "source ~/.bashrc" Enter
    echo "created session '$s'"
  fi
done

echo ""
echo "all sessions ready. attach with: tmux attach -t <session_name>"
echo "list sessions: tmux ls"
