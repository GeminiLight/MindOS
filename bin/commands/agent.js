import{bold,dim,cyan,green,red,yellow}from"../lib/colors.js";import{MCP_AGENTS,detectAgentPresence}from"../lib/mcp-agents.js";import{existsSync,readFileSync}from"node:fs";import{resolve}from"node:path";import{homedir}from"node:os";import{output,isJsonMode}from"../lib/command.js";function expandHome(p){return p.startsWith("~/")?resolve(homedir(),p.slice(2)):p}export const meta={name:"agent",group:"Knowledge",summary:"AI Agent management (list/info)",usage:"mindos agent <subcommand>"};export async function run(a,f){const s=a[0];if(!s||f.help||f.h){console.log(bold("mindos agent")+" — AI Agent management

Subcommands:
  list   List detected AI agents
  info   Show agent details

Agent Keys: "+Object.keys(MCP_AGENTS).join(", "));return}if(s==="list"||s==="ls")return agentList(f);if(s==="info")return agentInfo(a[1],f);console.error(red("Unknown: "+s));process.exit(1)}function hasMindosConfig(agent){const paths=[agent.global,agent.project].filter(Boolean).map(expandHome);for(const p of paths){try{if(!existsSync(p))continue;const raw=readFileSync(p,"utf-8").replace(///.*$/gm,"").replace(//*[\s\S]*?*//g,"");const data=JSON.parse(raw);const servers=data[agent.key]||{};if(Object.keys(servers).some(k=>k.toLowerCase().includes("mindos")))return true}catch{}}return false}function agentList(f){const agents=[];for(const[key,agent]of Object.entries(MCP_AGENTS)){if(!detectAgentPresence(key))continue;agents.push({key,name:agent.name,installed:true,mindosConnected:hasMindosConfig(agent)})}if(isJsonMode(f)){output({count:agents.length,agents},f);return}if(agents.length===0){console.log(dim("No AI agents detected."));return}console.log("
"+bold("Detected Agents ("+agents.length+"):")+"
");for(const a of agents){console.log("  "+a.name.padEnd(20)+" "+(a.mindosConnected?green("● connected"):dim("○ not connected")))}console.log("
"+dim("Connect: mindos mcp install <agent-key>")+"
")}function agentInfo(key,f){if(!key){console.error(red("Usage: mindos agent info <key>"));process.exit(1)}const agent=MCP_AGENTS[key];if(!agent){console.error(red("Unknown: "+key));process.exit(1)}const installed=detectAgentPresence(key);const connected=installed?hasMindosConfig(agent):false;const info={key,name:agent.name,installed,mindosConnected:connected,transport:agent.preferredTransport};if(isJsonMode(f)){output(info,f);return}console.log("
"+bold(agent.name)+"
  Key:       "+key+"
  Installed: "+(installed?green("yes"):red("no"))+"
  MindOS:    "+(connected?green("connected"):yellow("not connected"))+"
  Transport: "+agent.preferredTransport+(agent.global?"
  Config:    "+expandHome(agent.global):"")+"
")}