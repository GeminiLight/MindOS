#!/usr/bin/env bash
# tmux-manage.sh — project-slot session + agent window 管理器
# session 命名：{project}-{slot}，如 mos-dev, mos-algo
# 每个 session 里每个 agent 一个 window
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONF="$SCRIPT_DIR/tmux-sessions.conf"
TMUX_CONF="$SCRIPT_DIR/.tmux.conf"

# ── 颜色 ──
BOLD='\033[1m'
GREEN='\033[32m'
YELLOW='\033[33m'
CYAN='\033[36m'
RED='\033[31m'
DIM='\033[2m'
RESET='\033[0m'

# ── 解析配置 ──
PROJECT=""
WORK_DIR=""
INIT_CMD=""
declare -A AGENTS         # agent_name -> cli_command
declare -A AGENT_RESUME   # agent_name -> resume_template
declare -a SLOT_NAMES     # 有序 slot 列表
declare -A SLOT_AGENTS    # slot -> "agent1 agent2 ..."
declare -A SLOT_IDS       # "slot.agent" -> session_id

parse_conf() {
  [[ -f "$CONF" ]] || { echo -e "${RED}Config not found: $CONF${RESET}"; exit 1; }

  local section=""
  while IFS= read -r line; do
    line="${line%%#*}"
    line="$(echo "$line" | xargs)"
    [[ -z "$line" ]] && continue

    if [[ "$line" =~ ^\[(.+)\]$ ]]; then
      section="${BASH_REMATCH[1]}"
      continue
    fi

    local key="${line%%:*}" val="${line#*:}"
    key="$(echo "$key" | xargs)"
    val="$(echo "$val" | xargs)"

    case "$section" in
      project)
        case "$key" in
          name)     PROJECT="$val" ;;
          work_dir) WORK_DIR="$val" ;;
        esac
        ;;
      settings)
        case "$key" in
          init_cmd) INIT_CMD="$val" ;;
        esac
        ;;
      agents)
        # 格式: name: command | resume_template
        if [[ "$val" == *"|"* ]]; then
          local cmd="${val%%|*}" resume="${val#*|}"
          cmd="$(echo "$cmd" | xargs)"
          resume="$(echo "$resume" | xargs)"
          AGENTS["$key"]="$cmd"
          AGENT_RESUME["$key"]="$resume"
        else
          AGENTS["$key"]="$val"
          AGENT_RESUME["$key"]="--resume {slot}"
        fi
        ;;
      slots)
        SLOT_NAMES+=("$key")
        local agents_list=""
        IFS=',' read -ra parts <<< "$val"
        for a in "${parts[@]}"; do
          a="$(echo "$a" | xargs)"
          [[ -n "$a" ]] && agents_list+="$a "
        done
        SLOT_AGENTS["$key"]="${agents_list% }"
        ;;
      ids)
        # 格式: slot.agent: session_id
        SLOT_IDS["$key"]="$val"
        ;;
    esac
  done < "$CONF"

  [[ -n "$PROJECT" ]] || { echo -e "${RED}[project] name is required in config${RESET}"; exit 1; }
}

# ── 加载项目 tmux 配置 ──
source_tmux_conf() {
  [[ -f "$TMUX_CONF" ]] && tmux source-file "$TMUX_CONF" 2>/dev/null || true
}

# session 全名：{project}-{slot}
session_name() {
  echo "${PROJECT}-${1}"
}

# ── 创建/resume 一个 slot ──
ensure_slot() {
  local slot="$1"
  local sname
  sname="$(session_name "$slot")"
  local agents="${SLOT_AGENTS[$slot]}"
  local dir="${WORK_DIR:-$HOME}"
  local first=true

  echo -e "  ${BOLD}${CYAN}[${sname}]${RESET}"

  for agent_name in $agents; do
    local agent_cmd="${AGENTS[$agent_name]:-}"
    if [[ -z "$agent_cmd" ]]; then
      echo -e "    ${RED}✗${RESET} unknown agent: ${agent_name}"
      continue
    fi

    if $first; then
      if tmux has-session -t "$sname" 2>/dev/null; then
        if tmux list-windows -t "$sname" -F '#{window_name}' 2>/dev/null | grep -qx "$agent_name"; then
          echo -e "    ${DIM}↩ ${agent_name}${RESET} ${DIM}(window exists)${RESET}"
        else
          local win_count
          win_count=$(tmux list-windows -t "$sname" 2>/dev/null | wc -l)
          if (( win_count == 1 )); then
            local first_win
            first_win=$(tmux list-windows -t "$sname" -F '#{window_name}' 2>/dev/null | head -1)
            if [[ "$first_win" == "bash" || "$first_win" == "zsh" || "$first_win" =~ ^[0-9]+$ ]]; then
              tmux rename-window -t "$sname" "$agent_name"
              launch_agent "$sname" "$agent_name" "$agent_cmd" "$slot"
            else
              tmux new-window -t "$sname" -n "$agent_name" -c "$dir"
              init_and_launch "$sname" "$agent_name" "$agent_cmd" "$slot"
            fi
          else
            tmux new-window -t "$sname" -n "$agent_name" -c "$dir"
            init_and_launch "$sname" "$agent_name" "$agent_cmd" "$slot"
          fi
        fi
      else
        tmux new-session -d -s "$sname" -n "$agent_name" -c "$dir"
        source_tmux_conf
        echo -e "    ${GREEN}✓ ${agent_name}${RESET} ${GREEN}(session+window created)${RESET}"
        init_and_launch "$sname" "$agent_name" "$agent_cmd" "$slot"
      fi
      first=false
    else
      if tmux list-windows -t "$sname" -F '#{window_name}' 2>/dev/null | grep -qx "$agent_name"; then
        echo -e "    ${DIM}↩ ${agent_name}${RESET} ${DIM}(window exists)${RESET}"
      else
        tmux new-window -t "$sname" -n "$agent_name" -c "$dir"
        echo -e "    ${GREEN}✓ ${agent_name}${RESET} ${GREEN}(window created)${RESET}"
        init_and_launch "$sname" "$agent_name" "$agent_cmd" "$slot"
      fi
    fi
  done
}

# ── 初始化 + 启动 agent ──
init_and_launch() {
  local sname="$1" agent_name="$2" agent_cmd="$3" slot="$4"
  if [[ -n "$INIT_CMD" ]]; then
    tmux send-keys -t "${sname}:${agent_name}" "$INIT_CMD" Enter
    sleep 0.3
  fi
  launch_agent "$sname" "$agent_name" "$agent_cmd" "$slot"
}

launch_agent() {
  local sname="$1" agent_name="$2" agent_cmd="$3" slot="$4"
  local resume_tpl="${AGENT_RESUME[$agent_name]:-}"
  local resume_args=""
  local is_internal=false

  # > 前缀表示 agent 内部命令（两步模式）
  if [[ "$resume_tpl" == ">"* ]]; then
    is_internal=true
    resume_tpl="${resume_tpl#>}"
    resume_tpl="$(echo "$resume_tpl" | xargs)"
  fi

  if [[ -z "$resume_tpl" ]]; then
    resume_args=""
  elif [[ "$resume_tpl" == *"{id}"* ]]; then
    # 先从 [ids] 配置读取，没有再交互询问
    local id_key="${slot}.${agent_name}"
    local sid="${SLOT_IDS[$id_key]:-}"
    if [[ -z "$sid" ]]; then
      echo -e "    ${YELLOW}⚠${RESET}  ${agent_name} needs a session id to resume"
      echo -e "    ${DIM}(leave empty to start fresh, or add to [ids] as ${id_key}: <id>)${RESET}"
      read -rp "    session id: " sid
    fi
    if [[ -n "$sid" ]]; then
      resume_args="${resume_tpl//\{id\}/$sid}"
    fi
  elif [[ "$resume_tpl" == *"{name}"* || "$resume_tpl" == *"{slot}"* ]]; then
    resume_args="${resume_tpl//\{name\}/$sname}"
    resume_args="${resume_args//\{slot\}/$slot}"
  else
    resume_args="$resume_tpl"
  fi

  if $is_internal; then
    # 两步模式：先启动 agent，再发送内部命令
    echo -e "    ${CYAN}→${RESET} ${agent_cmd}"
    tmux send-keys -t "${sname}:${agent_name}" "$agent_cmd" Enter
    if [[ -n "$resume_args" ]]; then
      echo -e "    ${CYAN}→${RESET} ${DIM}(wait for agent)${RESET} then: ${resume_args}"
      sleep 3
      tmux send-keys -t "${sname}:${agent_name}" "$resume_args" Enter
    fi
  else
    # 一行模式：命令 + resume 参数拼在一起
    local full_cmd="${agent_cmd}${resume_args:+ $resume_args}"
    echo -e "    ${CYAN}→${RESET} ${full_cmd}"
    tmux send-keys -t "${sname}:${agent_name}" "$full_cmd" Enter
  fi
}

# ── 关闭一个 slot ──
kill_slot() {
  local slot="$1"
  local sname
  sname="$(session_name "$slot")"
  if tmux has-session -t "$sname" 2>/dev/null; then
    tmux kill-session -t "$sname"
    echo -e "  ${RED}✗${RESET} ${sname} ${RED}(killed)${RESET}"
  else
    echo -e "  ${DIM}-${RESET} ${sname} ${DIM}(not running)${RESET}"
  fi
}

# ── 清理野生 session ──
clean_sessions() {
  local existing
  existing="$(tmux ls 2>/dev/null | cut -d: -f1 || true)"
  [[ -z "$existing" ]] && { echo -e "  ${DIM}No sessions running.${RESET}"; return; }

  local cleaned=0
  while IFS= read -r sname; do
    [[ -z "$sname" ]] && continue
    local is_managed=false
    for slot in "${SLOT_NAMES[@]}"; do
      [[ "$(session_name "$slot")" == "$sname" ]] && is_managed=true
    done
    if ! $is_managed; then
      tmux kill-session -t "$sname"
      echo -e "  ${RED}✗${RESET} ${sname} ${RED}(killed — not in config)${RESET}"
      ((cleaned++))
    fi
  done <<< "$existing"

  if (( cleaned == 0 )); then
    echo -e "  ${GREEN}✓${RESET} No unmanaged sessions found."
  else
    echo -e "\n  ${GREEN}Cleaned ${cleaned} session(s).${RESET}"
  fi
}

# ── 状态展示 ──
show_status() {
  echo -e "\n${BOLD}Project: ${CYAN}${PROJECT}${RESET}  ${DIM}(${WORK_DIR})${RESET}\n"
  echo -e "${BOLD}Slot Status:${RESET}\n"

  for slot in "${SLOT_NAMES[@]}"; do
    local sname
    sname="$(session_name "$slot")"
    local agents="${SLOT_AGENTS[$slot]}"
    if tmux has-session -t "$sname" 2>/dev/null; then
      local windows
      windows=$(tmux list-windows -t "$sname" -F '#{window_name}' 2>/dev/null | tr '\n' ', ')
      windows="${windows%, }"
      echo -e "  ${GREEN}●${RESET} ${BOLD}${sname}${RESET}  windows: [${windows}]  ${DIM}(config: ${agents})${RESET}"
    else
      echo -e "  ${DIM}○${RESET} ${BOLD}${sname}${RESET}  ${DIM}(stopped, config: ${agents})${RESET}"
    fi
  done

  # unmanaged sessions
  local existing
  existing="$(tmux ls 2>/dev/null | cut -d: -f1 || true)"
  local unmanaged=""
  while IFS= read -r sname; do
    [[ -z "$sname" ]] && continue
    local is_managed=false
    for slot in "${SLOT_NAMES[@]}"; do
      [[ "$(session_name "$slot")" == "$sname" ]] && is_managed=true
    done
    if ! $is_managed; then
      unmanaged+="  ${YELLOW}?${RESET} ${sname}\n"
    fi
  done <<< "$existing"
  if [[ -n "$unmanaged" ]]; then
    echo -e "\n${BOLD}${YELLOW}Unmanaged:${RESET}"
    echo -e "$unmanaged"
  fi
}

# ── 选择 slots ──
select_slots() {
  echo -e "\n${BOLD}Select slots:${RESET}\n"
  local i=1
  for slot in "${SLOT_NAMES[@]}"; do
    local agents="${SLOT_AGENTS[$slot]}"
    echo -e "  ${CYAN}${i})${RESET} ${BOLD}${PROJECT}-${slot}${RESET}  ${DIM}[${agents}]${RESET}"
    ((i++))
  done
  echo -e "  ${CYAN}a)${RESET} ${BOLD}All slots${RESET}"
  echo ""
  read -rp "  Choice: " choice

  if [[ "$choice" == "a" || "$choice" == "A" ]]; then
    SELECTED_SLOTS=("${SLOT_NAMES[@]}")
  elif [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= ${#SLOT_NAMES[@]} )); then
    SELECTED_SLOTS=("${SLOT_NAMES[$((choice-1))]}")
  else
    echo -e "${RED}Invalid choice${RESET}"
    exit 1
  fi
}

# ── Dashboard 监控面板 ──
# 每个 pane 用 watch + capture-pane 实时显示 agent 屏幕（只读监控）
# 按 Ctrl+B 方向键切换 pane，按 Enter 跳入该 session 全屏操作
open_dashboard() {
  local dash_session="${PROJECT}-dashboard"

  # 确保所有 slot 的 session 都在跑
  for slot in "${SLOT_NAMES[@]}"; do
    local sname
    sname="$(session_name "$slot")"
    if ! tmux has-session -t "$sname" 2>/dev/null; then
      echo -e "  ${YELLOW}⚠${RESET} ${sname} not running, starting..."
      ensure_slot "$slot"
    fi
  done

  # 如果 dashboard session 已存在，直接 attach
  if tmux has-session -t "$dash_session" 2>/dev/null; then
    echo -e "  ${DIM}↩ Dashboard session exists, attaching...${RESET}"
    exec tmux attach -t "$dash_session"
  fi

  local total=${#SLOT_NAMES[@]}
  if (( total == 0 )); then
    echo -e "${RED}No slots configured.${RESET}"
    return
  fi

  local dir="${WORK_DIR:-$HOME}"
  local script_path="$SCRIPT_DIR/tmux-manage.sh"

  # 创建 monitor 脚本：实时刷新 capture-pane 内容，按 q 退出，按 Enter 跳入
  # 每个 pane 跑一个循环：抓屏 -> 显示 -> 等待按键/超时
  local monitor_cmd
  monitor_cmd='sess="$1"; while true; do clear; echo -e "\033[1;36m── $sess ──\033[0m"; tmux capture-pane -t "$sess" -p 2>/dev/null | tail -20; echo -e "\n\033[2m[Enter=attach  q=quit]\033[0m"; read -t 2 -n 1 key && { [[ "$key" == "" ]] && exec tmux attach -t "$sess"; [[ "$key" == "q" ]] && break; }; done'

  # 创建 dashboard session，第一个 pane
  local first_sname
  first_sname="$(session_name "${SLOT_NAMES[0]}")"
  tmux new-session -d -s "$dash_session" -c "$dir"
  tmux send-keys -t "$dash_session" "bash -c '$(echo "$monitor_cmd")' -- ${first_sname}" Enter

  # 为剩余 slot 各创建一个 pane
  local idx=1
  while (( idx < total )); do
    local sname
    sname="$(session_name "${SLOT_NAMES[$idx]}")"
    tmux split-window -t "$dash_session" -c "$dir"
    tmux select-layout -t "$dash_session" tiled 2>/dev/null || true
    tmux send-keys -t "$dash_session" "bash -c '$(echo "$monitor_cmd")' -- ${sname}" Enter
    ((idx++))
  done

  # 选中第一个 pane
  tmux select-pane -t "${dash_session}:.0"

  echo -e "\n${GREEN}Dashboard ready.${RESET} Layout: ${total} panes"
  echo -e "${DIM}  Ctrl+B arrow  — switch pane${RESET}"
  echo -e "${DIM}  Enter         — jump into that session (full screen)${RESET}"
  echo -e "${DIM}  Ctrl+B z      — zoom a pane${RESET}"
  echo -e "${DIM}  Ctrl+B d      — detach dashboard${RESET}\n"

  exec tmux attach -t "$dash_session"
}

# ── 交互式菜单 ──
main_menu() {
  echo -e "\n${BOLD}╔════════════════════════════════════════╗${RESET}"
  echo -e "${BOLD}║   tmux + agent session manager         ║${RESET}"
  echo -e "${BOLD}╚════════════════════════════════════════╝${RESET}"

  show_status

  echo -e "\n${BOLD}Actions:${RESET}\n"
  echo -e "  ${CYAN}1)${RESET} Start / Resume"
  echo -e "  ${CYAN}2)${RESET} Stop"
  echo -e "  ${CYAN}3)${RESET} Restart"
  echo -e "  ${CYAN}4)${RESET} Attach"
  echo -e "  ${CYAN}5)${RESET} Open in Editor"
  echo -e "  ${CYAN}6)${RESET} Clean (kill unmanaged sessions)"
  echo -e "  ${CYAN}7)${RESET} Dashboard (split-pane view)"
  echo -e "  ${CYAN}q)${RESET} Quit"
  echo ""
  read -rp "  Choice: " action

  case "$action" in
    1)
      select_slots
      echo ""
      for slot in "${SELECTED_SLOTS[@]}"; do ensure_slot "$slot"; done
      echo -e "\n${GREEN}Done.${RESET} Attach: ${BOLD}tmux attach -t ${PROJECT}-<slot>${RESET}"
      ;;
    2)
      select_slots
      echo ""
      for slot in "${SELECTED_SLOTS[@]}"; do kill_slot "$slot"; done
      ;;
    3)
      select_slots
      echo ""
      for slot in "${SELECTED_SLOTS[@]}"; do kill_slot "$slot"; done
      sleep 0.5
      for slot in "${SELECTED_SLOTS[@]}"; do ensure_slot "$slot"; done
      ;;
    4)
      echo ""
      local all_sessions
      all_sessions="$(tmux ls 2>/dev/null | cut -d: -f1 || true)"
      if [[ -z "$all_sessions" ]]; then
        echo -e "${RED}No active sessions.${RESET}"; exit 0
      fi
      local sarr=()
      while read -r s; do sarr+=("$s"); done <<< "$all_sessions"
      local i=1
      for s in "${sarr[@]}"; do echo -e "  ${CYAN}${i})${RESET} $s"; ((i++)); done
      echo ""
      read -rp "  Attach to: " choice
      if [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= ${#sarr[@]} )); then
        exec tmux attach -t "${sarr[$((choice-1))]}"
      else
        echo -e "${RED}Invalid choice${RESET}"
      fi
      ;;
    5)
      echo ""
      echo -e "  ${CYAN}1)${RESET} Cursor"
      echo -e "  ${CYAN}2)${RESET} VS Code"
      echo ""
      read -rp "  Editor: " ed_choice
      local dir="${WORK_DIR:-$PWD}"
      case "$ed_choice" in
        1) command -v cursor &>/dev/null && cursor "$dir" || echo -e "${RED}cursor command not found${RESET}" ;;
        2) command -v code &>/dev/null && code "$dir" || echo -e "${RED}code command not found${RESET}" ;;
        *) echo -e "${RED}Invalid choice${RESET}" ;;
      esac
      ;;
    6)
      echo ""
      clean_sessions
      ;;
    7)
      echo ""
      open_dashboard
      ;;
    q|Q) exit 0 ;;
    *) echo -e "${RED}Invalid choice${RESET}"; exit 1 ;;
  esac
}

# ── 快捷模式 ──
if [[ $# -ge 1 ]]; then
  parse_conf
  action="$1"
  target="${2:-all}"

  resolve_targets() {
    if [[ "$target" == "all" ]]; then
      echo "${SLOT_NAMES[@]}"
    else
      for slot in "${SLOT_NAMES[@]}"; do
        [[ "$slot" == "$target" ]] && { echo "$target"; return; }
      done
      echo -e "${RED}Unknown slot: $target${RESET}" >&2
      echo "Available: ${SLOT_NAMES[*]}" >&2
      exit 1
    fi
  }

  case "$action" in
    start)  for s in $(resolve_targets); do ensure_slot "$s"; done ;;
    stop)   for s in $(resolve_targets); do kill_slot "$s"; done ;;
    status) show_status ;;
    clean)  clean_sessions ;;
    dashboard) open_dashboard ;;
    *)      echo "Usage: $0 [start|stop|status|clean|dashboard] [slot|all]"; exit 1 ;;
  esac
  exit 0
fi

parse_conf
main_menu
