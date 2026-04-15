#!/usr/bin/env bash
# mos-connect.sh — 本地 Mac 脚本，在 Warp 里 2x2 分屏连接服务器 tmux
#
# 使用前：
#   1. 把这个脚本放到本地 Mac 上（比如 ~/bin/mos-connect.sh）
#   2. chmod +x ~/bin/mos-connect.sh
#   3. 修改下面的 SSH_HOST 为你 ~/.ssh/config 里的 Host 别名
#
# 用法：
#   ./mos-connect.sh              # 2x2 分屏连接 4 个 session
#   ./mos-connect.sh dev algo     # 只连接指定的（左右分屏）
#
# 布局：
#   ┌──────────┬──────────┐
#   │  mos-dev │ mos-algo │
#   ├──────────┼──────────┤
#   │  mos-ui  │mos-utils │
#   └──────────┴──────────┘

# ── 配置 ──
SSH_HOST="tx-devcloud"
PROJECT="mos"                    # 项目名前缀
SLOTS=(dev algo ui utils)          # 功能窗口列表（4 个 = 2x2）
REMOTE_DIR="~/code/sop_note"    # 远程工作目录

# ── 逻辑 ──
targets=("$@")
if [[ ${#targets[@]} -eq 0 ]]; then
  targets=("${SLOTS[@]}")
fi

total=${#targets[@]}

ssh_cmd() {
  local session="${PROJECT}-${1}"
  echo "ssh -t ${SSH_HOST} 'export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 && cd ${REMOTE_DIR} && tmux -u attach -t ${session} || tmux -u new-session -s ${session}'"
}

type_and_enter() {
  local cmd="$1"
  # 用剪贴板粘贴代替 keystroke，避免中文输入法干扰
  local old_clipboard
  old_clipboard="$(pbpaste 2>/dev/null)"
  echo -n "$cmd" | pbcopy
  osascript -e '
    tell application "System Events"
      tell process "Warp"
        keystroke "v" using command down
        delay 1
        key code 36
      end tell
    end tell
  '
  # 恢复剪贴板
  echo -n "$old_clipboard" | pbcopy 2>/dev/null
}

split_right() {
  # Cmd+D = 水平分屏（右边新 pane）
  osascript -e '
    tell application "System Events"
      tell process "Warp"
        keystroke "d" using command down
      end tell
    end tell
  '
}

split_down() {
  # Cmd+Shift+D = 垂直分屏（下方新 pane）
  osascript -e '
    tell application "System Events"
      tell process "Warp"
        keystroke "d" using {command down, shift down}
      end tell
    end tell
  '
}

focus_pane() {
  # Cmd+Option+方向键 切换 pane
  local direction="$1"  # up/down/left/right
  local key_code
  case "$direction" in
    up)    key_code=126 ;;
    down)  key_code=125 ;;
    left)  key_code=123 ;;
    right) key_code=124 ;;
  esac
  osascript -e "
    tell application \"System Events\"
      tell process \"Warp\"
        key code ${key_code} using {command down, option down}
      end tell
    end tell
  "
}

# ── 主流程 ──
echo "Opening ${total} panes in Warp..."

# 激活 Warp
osascript -e 'tell application "Warp" to activate'
sleep 0.5

if (( total == 1 )); then
  # 1 个：直接在当前窗口
  type_and_enter "$(ssh_cmd "${targets[0]}")"

elif (( total == 2 )); then
  # 2 个：左右分屏
  type_and_enter "$(ssh_cmd "${targets[0]}")"
  sleep 0.5
  split_right
  sleep 0.5
  type_and_enter "$(ssh_cmd "${targets[1]}")"

elif (( total == 3 )); then
  # 3 个：上 1 + 下 2
  type_and_enter "$(ssh_cmd "${targets[0]}")"
  sleep 0.5
  split_down
  sleep 0.5
  type_and_enter "$(ssh_cmd "${targets[1]}")"
  sleep 0.5
  split_right
  sleep 0.5
  type_and_enter "$(ssh_cmd "${targets[2]}")"

elif (( total >= 4 )); then
  # 4 个：2x2 网格
  #
  # Step 1: 第一个 pane (左上)
  type_and_enter "$(ssh_cmd "${targets[0]}")"
  sleep 0.5

  # Step 2: 水平分屏 → 右上
  split_right
  sleep 0.5
  type_and_enter "$(ssh_cmd "${targets[1]}")"
  sleep 0.5

  # Step 3: 回到左上，垂直分屏 → 左下
  focus_pane left
  sleep 0.3
  split_down
  sleep 0.5
  type_and_enter "$(ssh_cmd "${targets[2]}")"
  sleep 0.5

  # Step 4: 回到右上，垂直分屏 → 右下
  focus_pane right
  sleep 0.2
  focus_pane up
  sleep 0.3
  split_down
  sleep 0.5
  type_and_enter "$(ssh_cmd "${targets[3]}")"
fi

echo ""
echo "Done! 2x2 layout ready."
echo "  Cmd+Option+Arrow  — switch pane"
echo "  Cmd+Shift+Enter   — zoom pane"
