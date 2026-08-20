#!/usr/bin/env node

const os = require('os');
const http = require('http');
const fs = require('fs');
const net = require('net');
const dns = require('dns');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { Buffer } = require('buffer');
const axios = require('axios');
const si = require('systeminformation');
const grpc = require('@grpc/grpc-js');
const { spawn } = require('child_process');
const protoLoader = require('@grpc/proto-loader');
const { WebSocket, createWebSocketStream } = require('ws');

// ========================== 环境变量配置 ==========================
const UUID = process.env.UUID || 'a3f8c9e1-4b2d-4e7a-9c5f-2d8b1e6f3a9c';
const NEZHA_SERVER = process.env.NEZHA_SERVER || '';
const NEZHA_KEY = process.env.NEZHA_KEY || '';             
const DOMAIN = process.env.DOMAIN || 'vercel.starrynight.cc.cd';    
const AUTO_ACCESS = process.env.AUTO_ACCESS || false;      
const SUB_PATH = process.env.SUB_PATH || 'vercel';           
const NAME = process.env.NAME || 'Vercel';                       
const PORT = process.env.PORT || 3000;                    

// NZ-Agent
const AGENT_VERSION = 'nodejs-9.9.9';
const REPORT_DELAY = 4;
const RETRY_DELAY = 10000;
const IP_REPORT_PERIOD = 1800;
const NETWORK_TIMEOUT = 8000;

// 日志控制 
const SHOW_LOG = !!(process.env.SHOW_LOG);
function log(...args) { if (SHOW_LOG) console.log(...args); }
function logErr(...args) { if (SHOW_LOG) console.error(...args); }
function logWarn(...args) { if (SHOW_LOG) console.warn(...args); }

// 辅助工具
const WSPATH = process.env.WSPATH || UUID.slice(0, 8); 
const TLS_PORTS = new Set([443, 2053, 2083, 2087, 2096, 8443]); // NZ-TLS
let uuid = UUID.replace(/-/g, ""), CurrentDomain = DOMAIN, Tls = 'tls', CurrentPort = 443, ISP = '';
const DNS_SERVERS = ['8.8.4.4', '1.1.1.1'];
const BLOCKED_DOMAINS = [
  'speedtest.net', 'fast.com', 'speedtest.cn', 'speed.cloudflare.com', 'speedof.me',
   'testmy.net', 'bandwidth.place', 'speed.io', 'librespeed.org', 'speedcheck.org'
];

// TLS 检测
function shouldUseTLS(server) {
    const parts = server.split(':');
    if (parts.length < 2) return false;
    const port = parseInt(parts[parts.length - 1], 10);
    return TLS_PORTS.has(port);
}

// 屏蔽测速域名
function isBlockedDomain(host) {
  if (!host) return false;
  const hostLower = host.toLowerCase();
  return BLOCKED_DOMAINS.some(blocked => {
    return hostLower === blocked || hostLower.endsWith('.' + blocked);
  });
}

// 获取 isp
async function getisp() {
  try {
    const res = await axios.get('https://api.ip.sb/geoip', { headers: { 'User-Agent': 'Mozilla/5.0', timeout: 3000 }});
    const data = res.data;
    ISP = `${data.country_code}-${data.isp}`.replace(/ /g, '_');
  } catch (e) {
    try {
      const res2 = await axios.get('http://ip-api.com/json', { headers: { 'User-Agent': 'Mozilla/5.0', timeout: 3000 }});
      const data2 = res2.data;
      ISP = `${data2.countryCode}-${data2.org}`.replace(/ /g, '_');
    } catch (e2) {
      ISP = 'Unknown';
    }
  }
}

// 获取 ip
async function getip() {
  if (!DOMAIN || DOMAIN === 'your-domain.com') {
      try {
          const res = await axios.get('https://api-ipv4.ip.sb/ip', { timeout: 5000 });
          const ip = res.data.trim();
          CurrentDomain = ip; Tls = 'none'; CurrentPort = PORT;
      } catch (e) {
          console.error('Failed to get IP', e.message);
          CurrentDomain = 'cahnge-your-domain.com'; Tls = 'tls'; CurrentPort = 443;
      }
  } else {
      CurrentDomain = DOMAIN; Tls = 'tls'; CurrentPort = 443;
  }
}

// ========================== 内嵌完整前端页面 ==========================
const HTML_CONTENT = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>⏳ 时间万象 · 沉浸式管理</title>
    <!-- Font Awesome 图标库 (免费) -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css" />
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
        }

        body {
            background: linear-gradient(145deg, #0e121b 0%, #1a1f2e 100%);
            min-height: 100vh;
            padding: 2rem 1.5rem;
            color: #eef2f8;
        }

        /* 主容器 — 玻璃拟态 */
        .dashboard {
            max-width: 1440px;
            margin: 0 auto;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1.8rem;
        }

        /* 通用卡片 */
        .card {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(12px) saturate(180%);
            -webkit-backdrop-filter: blur(12px) saturate(180%);
            border-radius: 2.5rem 1.2rem 2.5rem 1.2rem;
            padding: 1.8rem 1.8rem 2rem;
            border: 1px solid rgba(255, 255, 255, 0.06);
            box-shadow: 0 25px 40px -16px rgba(0, 0, 0, 0.6), inset 0 0 0 1px rgba(255, 255, 255, 0.02);
            transition: all 0.25s ease;
        }

        .card:hover {
            border-color: rgba(255, 200, 150, 0.15);
            box-shadow: 0 30px 50px -18px #000000aa, inset 0 0 0 1px rgba(255, 200, 150, 0.05);
        }

        .full-width {
            grid-column: 1 / -1;
        }

        /* 标题 & 头部 */
        .card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 1.4rem;
        }

        .card-header h2 {
            font-weight: 600;
            font-size: 1.3rem;
            letter-spacing: 0.5px;
            background: linear-gradient(135deg, #f6e9d7, #ffd7b3);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            display: flex;
            align-items: center;
            gap: 0.6rem;
        }

        .card-header h2 i {
            color: #f3cba1;
            font-size: 1.2rem;
        }

        .badge {
            background: rgba(255, 215, 170, 0.12);
            padding: 0.3rem 1rem;
            border-radius: 60px;
            font-size: 0.7rem;
            font-weight: 500;
            letter-spacing: 0.5px;
            color: #d6c6b0;
            border: 1px solid rgba(255, 215, 170, 0.1);
        }

        /* ========== 左上：当前时间 + 聚焦 ========== */
        .time-hero {
            display: flex;
            flex-direction: column;
            gap: 0.6rem;
        }

        .time-hero .big-clock {
            font-size: clamp(3.2rem, 8vw, 5rem);
            font-weight: 700;
            letter-spacing: 6px;
            background: linear-gradient(to right, #f7e3c0, #ffdbb5, #f7c9b0);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            line-height: 1;
            text-shadow: 0 0 40px rgba(255, 200, 130, 0.08);
        }

        .time-hero .date-row {
            display: flex;
            flex-wrap: wrap;
            gap: 1.2rem 2rem;
            color: #bfb8ae;
            font-weight: 300;
            font-size: 0.95rem;
            letter-spacing: 0.3px;
        }

        .time-hero .date-row span i {
            margin-right: 0.5rem;
            color: #f3cba1;
        }

        .focus-tag {
            margin-top: 0.8rem;
            background: rgba(255, 210, 160, 0.06);
            border-radius: 60px;
            padding: 0.5rem 1.2rem;
            display: inline-flex;
            align-items: center;
            gap: 0.7rem;
            border: 1px solid rgba(255, 210, 160, 0.1);
            font-size: 0.9rem;
        }

        .focus-tag i {
            color: #f5b88e;
        }

        /* ========== 右上：进度环 ========== */
        .progress-ring-wrap {
            display: flex;
            justify-content: space-around;
            align-items: center;
            flex-wrap: wrap;
            gap: 1rem;
        }

        .ring-item {
            display: flex;
            flex-direction: column;
            align-items: center;
        }

        .ring-item canvas {
            width: 80px;
            height: 80px;
            display: block;
        }

        .ring-label {
            margin-top: 0.4rem;
            font-size: 0.75rem;
            color: #b8ae9e;
            letter-spacing: 0.5px;
        }

        .ring-value {
            font-weight: 600;
            color: #eadbc8;
            font-size: 0.9rem;
        }

        /* ========== 任务看板 ========== */
        .task-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1rem;
        }

        .task-item {
            background: rgba(30, 40, 60, 0.3);
            border-radius: 1.8rem 0.6rem 1.8rem 0.6rem;
            padding: 1rem 1.2rem;
            border-left: 3px solid #f3b58c;
            transition: all 0.2s;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .task-item .task-info {
            display: flex;
            flex-direction: column;
            gap: 0.2rem;
        }

        .task-item .task-title {
            font-weight: 500;
            font-size: 0.95rem;
            color: #f0e6db;
        }

        .task-item .task-meta {
            font-size: 0.7rem;
            color: #938b7f;
            display: flex;
            gap: 0.8rem;
        }

        .task-item .task-tag {
            background: rgba(255, 200, 150, 0.1);
            padding: 0.15rem 0.6rem;
            border-radius: 20px;
            font-size: 0.6rem;
            color: #dbbca4;
        }

        .task-item .task-check {
            width: 28px;
            height: 28px;
            border-radius: 30px;
            border: 1px solid rgba(255, 215, 170, 0.2);
            background: transparent;
            color: #b8a89a;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: 0.2s;
        }

        .task-item .task-check:hover {
            background: rgba(255, 215, 170, 0.1);
            border-color: #f3cba1;
            color: #f3cba1;
        }

        .task-item.done {
            opacity: 0.5;
            border-left-color: #6f8f7c;
        }

        .task-item.done .task-title {
            text-decoration: line-through;
            color: #8f8a82;
        }

        /* ========== 时间轴 ========== */
        .timeline {
            display: flex;
            flex-direction: column;
            gap: 0.8rem;
            margin-top: 0.5rem;
        }

        .tl-item {
            display: flex;
            align-items: center;
            gap: 1rem;
            background: rgba(0, 0, 0, 0.15);
            padding: 0.6rem 1.2rem;
            border-radius: 40px;
            border-left: 3px solid #f3b58c;
        }

        .tl-item .tl-time {
            font-weight: 600;
            font-size: 0.8rem;
            color: #e6d5be;
            min-width: 70px;
        }

        .tl-item .tl-content {
            flex: 1;
            font-size: 0.9rem;
            color: #d9cebf;
        }

        .tl-item .tl-icon {
            color: #ecc39e;
            font-size: 0.9rem;
            width: 24px;
            text-align: center;
        }

        .tl-item.past {
            opacity: 0.6;
            border-left-color: #5d6b7a;
        }

        .tl-item.now {
            border-left-color: #f5b88e;
            background: rgba(255, 200, 150, 0.06);
            box-shadow: 0 0 20px rgba(255, 200, 150, 0.02);
        }

        /* ========== 统计 ========== */
        .stats-row {
            display: flex;
            flex-wrap: wrap;
            justify-content: space-between;
            gap: 1rem;
        }

        .stat-block {
            background: rgba(0, 0, 0, 0.2);
            border-radius: 2rem 0.6rem 2rem 0.6rem;
            padding: 0.8rem 1.5rem;
            flex: 1;
            min-width: 100px;
            border: 1px solid rgba(255, 255, 255, 0.02);
        }

        .stat-block .num {
            font-size: 1.6rem;
            font-weight: 700;
            color: #f3dcc4;
        }

        .stat-block .label {
            font-size: 0.7rem;
            color: #a09586;
            letter-spacing: 0.5px;
        }

        /* ========== 番茄钟 ========== */
        .pomodoro-box {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.8rem;
        }

        .pomodoro-box .pomo-display {
            font-size: 3.4rem;
            font-weight: 600;
            letter-spacing: 6px;
            background: linear-gradient(to right, #f7e3c0, #f7d0b0);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
        }

        .pomo-controls {
            display: flex;
            gap: 1rem;
            flex-wrap: wrap;
            justify-content: center;
        }

        .pomo-controls button {
            background: rgba(255, 215, 170, 0.06);
            border: 1px solid rgba(255, 215, 170, 0.15);
            padding: 0.4rem 1.6rem;
            border-radius: 60px;
            color: #e6d5be;
            font-weight: 500;
            font-size: 0.85rem;
            cursor: pointer;
            transition: 0.2s;
            backdrop-filter: blur(4px);
            display: inline-flex;
            align-items: center;
            gap: 0.4rem;
        }

        .pomo-controls button:hover {
            background: rgba(255, 215, 170, 0.12);
            border-color: #f3cba1;
            color: #f7eee5;
        }

        .pomo-controls button:active {
            transform: scale(0.95);
        }

        /* ========== 响应式 ========== */
        @media (max-width: 900px) {
            .dashboard {
                grid-template-columns: 1fr;
                gap: 1.5rem;
            }
            .task-grid {
                grid-template-columns: 1fr;
            }
            .ring-item canvas {
                width: 70px;
                height: 70px;
            }
        }

        @media (max-width: 480px) {
            body {
                padding: 1rem 0.8rem;
            }
            .card {
                padding: 1.2rem 1rem;
            }
            .stat-block {
                min-width: 70px;
                padding: 0.6rem 1rem;
            }
            .tl-item {
                flex-wrap: wrap;
                gap: 0.2rem;
            }
            .tl-item .tl-time {
                min-width: 60px;
                font-size: 0.7rem;
            }
        }

        /* 滚动条 */
        ::-webkit-scrollbar {
            width: 4px;
            background: transparent;
        }
        ::-webkit-scrollbar-thumb {
            background: rgba(255, 215, 170, 0.2);
            border-radius: 10px;
        }

        .glass-btn {
            background: rgba(255, 255, 255, 0.02);
            border: none;
            color: #c9beb0;
            cursor: pointer;
            padding: 0.2rem 0.6rem;
            border-radius: 30px;
            font-size: 0.8rem;
            transition: 0.15s;
        }
        .glass-btn:hover {
            background: rgba(255, 255, 255, 0.05);
            color: #f0e6db;
        }

        .flex-between {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .gap-2 {
            gap: 0.5rem;
        }
        .mt-2 {
            margin-top: 0.8rem;
        }
        .text-muted {
            color: #887e72;
            font-size: 0.8rem;
        }

        /* 任务添加行 */
        .add-task-row {
            display: flex;
            gap: 0.6rem;
            margin-top: 1rem;
        }
        .add-task-row input {
            flex: 1;
            background: rgba(0, 0, 0, 0.25);
            border: 1px solid rgba(255, 215, 170, 0.08);
            border-radius: 60px;
            padding: 0.5rem 1.2rem;
            color: #f0e6db;
            font-size: 0.9rem;
            outline: none;
            transition: 0.2s;
        }
        .add-task-row input:focus {
            border-color: rgba(255, 215, 170, 0.3);
            background: rgba(0, 0, 0, 0.35);
        }
        .add-task-row input::placeholder {
            color: #6a6258;
        }
        .add-task-row button {
            background: rgba(255, 215, 170, 0.08);
            border: 1px solid rgba(255, 215, 170, 0.1);
            border-radius: 60px;
            padding: 0.5rem 1.6rem;
            color: #e6d5be;
            font-weight: 500;
            cursor: pointer;
            transition: 0.15s;
        }
        .add-task-row button:hover {
            background: rgba(255, 215, 170, 0.15);
        }
    </style>
</head>
<body>

<div class="dashboard">

    <!-- ===== 卡片 1: 当前时间 + 聚焦 ===== -->
    <div class="card">
        <div class="card-header">
            <h2><i class="fas fa-clock"></i> 此刻</h2>
            <span class="badge"><i class="fas fa-circle" style="color: #f5b88e; font-size: 0.5rem; margin-right: 6px;"></i> 专注</span>
        </div>
        <div class="time-hero">
            <div class="big-clock" id="liveClock">--:--:--</div>
            <div class="date-row">
                <span><i class="fas fa-calendar-alt"></i> <span id="liveDate">----年--月--日</span></span>
                <span><i class="fas fa-map-pin"></i> <span id="weekDay">星期-</span></span>
            </div>
            <div class="focus-tag">
                <i class="fas fa-bullseye"></i> 今日聚焦 · 深度工作 3 小时
                <span style="margin-left: auto; font-size: 0.8rem; color: #b8a89a;">剩余 1.2h</span>
            </div>
        </div>
    </div>

    <!-- ===== 卡片 2: 环形进度 ===== -->
    <div class="card">
        <div class="card-header">
            <h2><i class="fas fa-chart-pie"></i> 今日进度</h2>
            <span class="badge"><i class="fas fa-sync-alt fa-fw"></i> 实时</span>
        </div>
        <div class="progress-ring-wrap">
            <div class="ring-item">
                <canvas id="ringWork" width="100" height="100"></canvas>
                <span class="ring-label">工作时间</span>
                <span class="ring-value" id="workPercent">72%</span>
            </div>
            <div class="ring-item">
                <canvas id="ringHealth" width="100" height="100"></canvas>
                <span class="ring-label">健康习惯</span>
                <span class="ring-value" id="healthPercent">45%</span>
            </div>
            <div class="ring-item">
                <canvas id="ringLearn" width="100" height="100"></canvas>
                <span class="ring-label">学习成长</span>
                <span class="ring-value" id="learnPercent">88%</span>
            </div>
        </div>
    </div>

    <!-- ===== 卡片 3: 任务看板 (全宽) ===== -->
    <div class="card full-width">
        <div class="card-header">
            <h2><i class="fas fa-tasks"></i> 任务看板 · 四象限</h2>
            <div style="display: flex; gap: 0.5rem;">
                <span class="badge" style="background: rgba(200,200,200,0.05);">优先级</span>
                <span class="badge">今日 6 项</span>
            </div>
        </div>

        <div class="task-grid" id="taskGrid">
            <!-- 任务由 JS 动态渲染 -->
        </div>

        <!-- 添加任务 -->
        <div class="add-task-row">
            <input type="text" id="newTaskInput" placeholder="新任务 … 例如：写周报" />
            <button id="addTaskBtn"><i class="fas fa-plus"></i> 添加</button>
        </div>
    </div>

    <!-- ===== 卡片 4: 时间轴 (全宽) ===== -->
    <div class="card full-width">
        <div class="card-header">
            <h2><i class="fas fa-stream"></i> 今日时间线</h2>
            <span class="badge"><i class="fas fa-flag"></i> 8 个事件</span>
        </div>
        <div class="timeline" id="timelineContainer">
            <!-- 由 JS 动态生成 -->
        </div>
    </div>

    <!-- ===== 卡片 5: 统计 + 番茄钟 ===== -->
    <div class="card full-width">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; align-items: start;">
            <!-- 左侧统计 -->
            <div>
                <div class="card-header" style="margin-bottom: 0.8rem;">
                    <h2 style="font-size: 1rem;"><i class="fas fa-chart-bar"></i> 统计概览</h2>
                </div>
                <div class="stats-row">
                    <div class="stat-block"><span class="num">42</span> <span class="label">总任务</span></div>
                    <div class="stat-block"><span class="num">28</span> <span class="label">已完成</span></div>
                    <div class="stat-block"><span class="num">6.2h</span> <span class="label">总专注</span></div>
                    <div class="stat-block"><span class="num">4</span> <span class="label">进行中</span></div>
                </div>
            </div>
            <!-- 右侧番茄钟 -->
            <div>
                <div class="card-header" style="margin-bottom: 0.4rem;">
                    <h2 style="font-size: 1rem;"><i class="fas fa-stopwatch"></i> 番茄钟</h2>
                </div>
                <div class="pomodoro-box">
                    <div class="pomo-display" id="pomoDisplay">25:00</div>
                    <div class="pomo-controls">
                        <button id="pomoStart"><i class="fas fa-play"></i> 开始</button>
                        <button id="pomoPause"><i class="fas fa-pause"></i> 暂停</button>
                        <button id="pomoReset"><i class="fas fa-undo-alt"></i> 重置</button>
                    </div>
                    <div style="font-size: 0.75rem; color: #887e72;">
                        <span id="pomoStatus">就绪</span> · 循环 <span id="pomoCycle">0</span>
                    </div>
                </div>
            </div>
        </div>
    </div>

</div>

<script>
    (function() {
        "use strict";

        // ---- 工具 ----
        function pad(n) { return n.toString().padStart(2, '0'); }

        // ---- 实时时钟 ----
        function updateClock() {
            const now = new Date();
            document.getElementById('liveClock').textContent =
                pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
            document.getElementById('liveDate').textContent =
                now.getFullYear() + '年' + pad(now.getMonth() + 1) + '月' + pad(now.getDate()) + '日';
            const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
            document.getElementById('weekDay').textContent = weekdays[now.getDay()];
        }
        updateClock();
        setInterval(updateClock, 1000);

        // ---- 环形进度图 ----
        function drawRing(canvasId, percent, color1, color2) {
            const canvas = document.getElementById(canvasId);
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const w = canvas.width, h = canvas.height;
            const cx = w / 2, cy = h / 2, radius = 36, lineWidth = 8;
            ctx.clearRect(0, 0, w, h);

            // 背景弧
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = lineWidth;
            ctx.stroke();

            // 前景弧
            const start = -Math.PI / 2;
            const end = start + (2 * Math.PI * (percent / 100));
            ctx.beginPath();
            ctx.arc(cx, cy, radius, start, end);
            const grad = ctx.createLinearGradient(0, 0, w, h);
            grad.addColorStop(0, color1);
            grad.addColorStop(1, color2);
            ctx.strokeStyle = grad;
            ctx.lineWidth = lineWidth;
            ctx.lineCap = 'round';
            ctx.stroke();

            // 内圈小点
            ctx.beginPath();
            ctx.arc(cx, cy, radius - 2, 0, 2 * Math.PI);
            ctx.strokeStyle = 'rgba(255,255,255,0.02)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // 初始化环形
        drawRing('ringWork', 72, '#f5b88e', '#f3d09e');
        drawRing('ringHealth', 45, '#8fc9b0', '#b4d9c4');
        drawRing('ringLearn', 88, '#b8a8e0', '#d4c4f0');

        // 动态模拟数值 (每分钟变化)
        setInterval(() => {
            const w = Math.min(100, Math.floor(72 + (Math.random() - 0.5) * 6));
            const h = Math.min(100, Math.max(20, Math.floor(45 + (Math.random() - 0.5) * 8)));
            const l = Math.min(100, Math.max(60, Math.floor(88 + (Math.random() - 0.5) * 6)));
            document.getElementById('workPercent').textContent = w + '%';
            document.getElementById('healthPercent').textContent = h + '%';
            document.getElementById('learnPercent').textContent = l + '%';
            drawRing('ringWork', w, '#f5b88e', '#f3d09e');
            drawRing('ringHealth', h, '#8fc9b0', '#b4d9c4');
            drawRing('ringLearn', l, '#b8a8e0', '#d4c4f0');
        }, 8000);

        // ---- 任务看板 (四象限风格) ----
        let tasks = [
            { id: 1, title: '完成项目方案', tag: '重要·紧急', done: false },
            { id: 2, title: '回复客户邮件', tag: '重要·不紧急', done: false },
            { id: 3, title: '整理笔记', tag: '不重要·紧急', done: true },
            { id: 4, title: '阅读 30min', tag: '不重要·不紧急', done: false },
            { id: 5, title: '团队周会', tag: '重要·紧急', done: false },
            { id: 6, title: '代码 review', tag: '重要·不紧急', done: false },
        ];
        let taskIdCounter = 7;

        function renderTasks() {
            const grid = document.getElementById('taskGrid');
            grid.innerHTML = '';
            tasks.forEach(t => {
                const div = document.createElement('div');
                div.className = 'task-item' + (t.done ? ' done' : '');
                div.innerHTML = \`
                    <div class="task-info">
                        <div class="task-title">\${t.title}</div>
                        <div class="task-meta">
                            <span class="task-tag">\${t.tag}</span>
                            <span>\${t.done ? '✅ 已完成' : '⏳ 进行中'}</span>
                        </div>
                    </div>
                    <button class="task-check" data-id="\${t.id}" aria-label="切换完成状态">
                        <i class="fas \${t.done ? 'fa-check-circle' : 'fa-circle'}"></i>
                    </button>
                \`;
                grid.appendChild(div);
            });
            // 绑定切换事件
            document.querySelectorAll('.task-check').forEach(btn => {
                btn.addEventListener('click', function(e) {
                    const id = parseInt(this.dataset.id);
                    const task = tasks.find(t => t.id === id);
                    if (task) {
                        task.done = !task.done;
                        renderTasks();
                        updateStats();
                    }
                });
            });
            updateStats();
        }

        // 添加任务
        document.getElementById('addTaskBtn').addEventListener('click', function() {
            const input = document.getElementById('newTaskInput');
            const text = input.value.trim();
            if (!text) return;
            const tags = ['重要·紧急', '重要·不紧急', '不重要·紧急', '不重要·不紧急'];
            const randomTag = tags[Math.floor(Math.random() * tags.length)];
            tasks.push({ id: taskIdCounter++, title: text, tag: randomTag, done: false });
            input.value = '';
            renderTasks();
        });
        // 回车添加
        document.getElementById('newTaskInput').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') document.getElementById('addTaskBtn').click();
        });

        // 更新统计
        function updateStats() {
            const total = tasks.length;
            const done = tasks.filter(t => t.done).length;
            const stats = document.querySelectorAll('.stat-block .num');
            if (stats.length >= 4) {
                stats[0].textContent = total;
                stats[1].textContent = done;
                stats[2].textContent = (done / total * 6.2).toFixed(1) + 'h';
                stats[3].textContent = total - done;
            }
        }

        // ---- 时间轴 (动态) ----
        const timelineEvents = [
            { time: '07:30', icon: '🌅', content: '起床 · 晨间冥想', past: true },
            { time: '08:15', icon: '☕', content: '早餐 & 规划', past: true },
            { time: '09:00', icon: '💻', content: '深度工作 (编码)', past: true },
            { time: '11:30', icon: '📞', content: '团队站会', past: true },
            { time: '13:00', icon: '🍱', content: '午休 · 散步', past: false },
            { time: '14:30', icon: '📚', content: '学习 · 系统设计', past: false },
            { time: '16:00', icon: '✍️', content: '文档 & 复盘', past: false },
            { time: '18:30', icon: '🏋️', content: '健身 · 放松', past: false },
        ];

        function renderTimeline() {
            const container = document.getElementById('timelineContainer');
            container.innerHTML = '';
            const now = new Date();
            const currentMinutes = now.getHours() * 60 + now.getMinutes();
            timelineEvents.forEach(ev => {
                const [h, m] = ev.time.split(':').map(Number);
                const evMinutes = h * 60 + m;
                const isPast = evMinutes < currentMinutes;
                const div = document.createElement('div');
                div.className = 'tl-item' + (isPast ? ' past' : '') + (ev.content.includes('深度工作') ? ' now' : '');
                div.innerHTML = \`
                    <span class="tl-time">\${ev.time}</span>
                    <span class="tl-icon">\${ev.icon}</span>
                    <span class="tl-content">\${ev.content}</span>
                    <span style="font-size:0.6rem; color:#5d5a55;">\${isPast ? '✓ 已过' : '⏳ 未到'}</span>
                \`;
                container.appendChild(div);
            });
        }

        // ---- 番茄钟 ----
        let pomoSeconds = 25 * 60;
        let pomoInterval = null;
        let pomoRunning = false;
        let pomoCycleCount = 0;

        function updatePomoDisplay() {
            const m = Math.floor(pomoSeconds / 60);
            const s = pomoSeconds % 60;
            document.getElementById('pomoDisplay').textContent = pad(m) + ':' + pad(s);
            document.getElementById('pomoStatus').textContent = pomoRunning ? '运行中' : '已暂停';
        }

        function pomoTick() {
            if (pomoSeconds <= 0) {
                clearInterval(pomoInterval);
                pomoRunning = false;
                pomoCycleCount++;
                document.getElementById('pomoCycle').textContent = pomoCycleCount;
                document.getElementById('pomoStatus').textContent = '✅ 完成!';
                pomoSeconds = 25 * 60;
                updatePomoDisplay();
                return;
            }
            pomoSeconds--;
            updatePomoDisplay();
        }

        document.getElementById('pomoStart').addEventListener('click', function() {
            if (pomoRunning) return;
            if (pomoSeconds <= 0) { pomoSeconds = 25 * 60; }
            pomoRunning = true;
            document.getElementById('pomoStatus').textContent = '运行中';
            pomoInterval = setInterval(pomoTick, 1000);
        });
        document.getElementById('pomoPause').addEventListener('click', function() {
            if (pomoInterval) {
                clearInterval(pomoInterval);
                pomoInterval = null;
                pomoRunning = false;
                document.getElementById('pomoStatus').textContent = '已暂停';
            }
        });
        document.getElementById('pomoReset').addEventListener('click', function() {
            if (pomoInterval) {
                clearInterval(pomoInterval);
                pomoInterval = null;
            }
            pomoRunning = false;
            pomoSeconds = 25 * 60;
            document.getElementById('pomoStatus').textContent = '已重置';
            updatePomoDisplay();
        });

        // ---- 初始化 ----
        renderTasks();
        renderTimeline();
        updatePomoDisplay();

        setInterval(renderTimeline, 60000);

        document.getElementById('timelineContainer').addEventListener('dblclick', function() {
            renderTimeline();
        });

        console.log('⏳ 时间万象 · 沉浸管理已启动');
    })();
</script>
</body>
</html>`;

// ========================== HTTP 路由 ==========================
const httpServer = http.createServer(async (req, res) => {
  if (req.url === '/' || req.url.startsWith('/?')) {
    // 强制不缓存，确保立即生效
    res.writeHead(200, { 
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(HTML_CONTENT);
    return;
  } else if (req.url === `/${SUB_PATH}`) {
    await getisp();
    await getip();
    const namePart = NAME ? `${NAME}-${ISP}` : ISP;
    const tlsParam = Tls === 'tls' ? 'tls' : 'none';
    const ssTlsParam = Tls === 'tls' ? 'tls;' : '';
    const vlsURL = `vless://${UUID}@${CurrentDomain}:${CurrentPort}?encryption=none&security=${tlsParam}&sni=${CurrentDomain}&fp=chrome&type=ws&host=${CurrentDomain}&path=%2F${WSPATH}#${namePart}`;
    const troURL = `trojan://${UUID}@${CurrentDomain}:${CurrentPort}?security=${tlsParam}&sni=${CurrentDomain}&fp=chrome&type=ws&host=${CurrentDomain}&path=%2F${WSPATH}#${namePart}`;
    const ssMethodPassword = Buffer.from(`none:${UUID}`).toString('base64');
    const ssURL = `ss://${ssMethodPassword}@${CurrentDomain}:${CurrentPort}?plugin=v2ray-plugin;mode%3Dwebsocket;host%3D${CurrentDomain};path%3D%2F${WSPATH};${ssTlsParam}sni%3D${CurrentDomain};skip-cert-verify%3Dtrue;mux%3D0#${namePart}`;
    const subscription = vlsURL + '\n' + troURL + '\n' + ssURL;
    const base64Content = Buffer.from(subscription).toString('base64');

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(base64Content + '\n');
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found\n');
  }
});

// Custom DNS
function resolveHost(host) {
  return new Promise((resolve, reject) => {
    if (/^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(host)) {
      resolve(host);
      return;
    }
    let attempts = 0;
    function tryNextDNS() {
      if (attempts >= DNS_SERVERS.length) {
        reject(new Error(`Failed to resolve ${host} with all DNS servers`));
        return;
      }
      const dnsServer = DNS_SERVERS[attempts];
      attempts++;
      const dnsQuery = `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A`;
      axios.get(dnsQuery, {
        timeout: 5000,
        headers: { 'Accept': 'application/dns-json' }
      })
        .then(response => {
          const data = response.data;
          if (data.Status === 0 && data.Answer && data.Answer.length > 0) {
            const ip = data.Answer.find(record => record.type === 1);
            if (ip) { resolve(ip.data); return; }
          }
          tryNextDNS();
        })
        .catch(error => { tryNextDNS(); });
    }
    tryNextDNS();
  });
}

// VLESS
function handleVlsConnection(ws, msg) {
  const [VERSION] = msg;
  const id = msg.slice(1, 17);
  if (!id.every((v, i) => v == parseInt(uuid.substr(i * 2, 2), 16))) return false;

  let i = msg.slice(17, 18).readUInt8() + 19;
  const port = msg.slice(i, i += 2).readUInt16BE(0);
  const ATYP = msg.slice(i, i += 1).readUInt8();
  const host = ATYP == 1 ? msg.slice(i, i += 4).join('.') :
    (ATYP == 2 ? new TextDecoder().decode(msg.slice(i + 1, i += 1 + msg.slice(i, i + 1).readUInt8())) :
      (ATYP == 3 ? msg.slice(i, i += 16).reduce((s, b, i, a) => (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), []).map(b => b.readUInt16BE(0).toString(16)).join(':') : ''));

  if (isBlockedDomain(host)) { ws.close(); return false; }
  ws.send(new Uint8Array([VERSION, 0]));
  const duplex = createWebSocketStream(ws);
  resolveHost(host)
    .then(resolvedIP => {
      net.connect({ host: resolvedIP, port }, function () {
        this.write(msg.slice(i));
        duplex.on('error', () => { }).pipe(this).on('error', () => { }).pipe(duplex);
      }).on('error', () => { });
    })
    .catch(error => {
      net.connect({ host, port }, function () {
        this.write(msg.slice(i));
        duplex.on('error', () => { }).pipe(this).on('error', () => { }).pipe(duplex);
      }).on('error', () => { });
    });
  return true;
}

// Trojan
function handleTrojConnection(ws, msg) {
  try {
    if (msg.length < 58) return false;
    const receivedPasswordHash = msg.slice(0, 56).toString();
    const possiblePasswords = [UUID];
    let matchedPassword = null;
    for (const pwd of possiblePasswords) {
      const hash = crypto.createHash('sha224').update(pwd).digest('hex');
      if (hash === receivedPasswordHash) { matchedPassword = pwd; break; }
    }
    if (!matchedPassword) return false;
    let offset = 56;
    if (msg[offset] === 0x0d && msg[offset + 1] === 0x0a) offset += 2;
    const cmd = msg[offset];
    if (cmd !== 0x01) return false;
    offset += 1;
    const atyp = msg[offset];
    offset += 1;
    let host, port;
    if (atyp === 0x01) {
      host = msg.slice(offset, offset + 4).join('.'); offset += 4;
    } else if (atyp === 0x03) {
      const hostLen = msg[offset]; offset += 1;
      host = msg.slice(offset, offset + hostLen).toString(); offset += hostLen;
    } else if (atyp === 0x04) {
      host = msg.slice(offset, offset + 16).reduce((s, b, i, a) => (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), []).map(b => b.readUInt16BE(0).toString(16)).join(':'); offset += 16;
    } else { return false; }
    port = msg.readUInt16BE(offset); offset += 2;
    if (offset < msg.length && msg[offset] === 0x0d && msg[offset + 1] === 0x0a) offset += 2;
    if (isBlockedDomain(host)) { ws.close(); return false; }
    const duplex = createWebSocketStream(ws);
    resolveHost(host)
      .then(resolvedIP => {
        net.connect({ host: resolvedIP, port }, function () {
          if (offset < msg.length) this.write(msg.slice(offset));
          duplex.on('error', () => { }).pipe(this).on('error', () => { }).pipe(duplex);
        }).on('error', () => { });
      })
      .catch(error => {
        net.connect({ host, port }, function () {
          if (offset < msg.length) this.write(msg.slice(offset));
          duplex.on('error', () => { }).pipe(this).on('error', () => { }).pipe(duplex);
        }).on('error', () => { });
      });
    return true;
  } catch (error) { return false; }
}

// Shadowsocks
function handleSsConnection(ws, msg) {
  try {
    let offset = 0;
    const atyp = msg[offset]; offset += 1;
    let host, port;
    if (atyp === 0x01) {
      host = msg.slice(offset, offset + 4).join('.'); offset += 4;
    } else if (atyp === 0x03) {
      const hostLen = msg[offset]; offset += 1;
      host = msg.slice(offset, offset + hostLen).toString(); offset += hostLen;
    } else if (atyp === 0x04) {
      host = msg.slice(offset, offset + 16).reduce((s, b, i, a) => (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), []).map(b => b.readUInt16BE(0).toString(16)).join(':'); offset += 16;
    } else { return false; }
    port = msg.readUInt16BE(offset); offset += 2;
    if (isBlockedDomain(host)) { ws.close(); return false; }
    const duplex = createWebSocketStream(ws);
    resolveHost(host)
      .then(resolvedIP => {
        net.connect({ host: resolvedIP, port }, function () {
          if (offset < msg.length) this.write(msg.slice(offset));
          duplex.on('error', () => { }).pipe(this).on('error', () => { }).pipe(duplex);
        }).on('error', () => { });
      })
      .catch(error => {
        net.connect({ host, port }, function () {
          if (offset < msg.length) this.write(msg.slice(offset));
          duplex.on('error', () => { }).pipe(this).on('error', () => { }).pipe(duplex);
        }).on('error', () => { });
      });
    return true;
  } catch (error) { return false; }
}

// WebSocket 监听
const wss = new WebSocket.Server({ server: httpServer });
wss.on('connection', (ws, req) => {
  const url = req.url || '';
  const expectedPath = `/${WSPATH}`;
  if (!url.startsWith(expectedPath)) { ws.close(); return; }

  ws.once('message', msg => {
    if (msg.length > 17 && msg[0] === 0) {
      const id = msg.slice(1, 17);
      const isVless = id.every((v, i) => v == parseInt(uuid.substr(i * 2, 2), 16));
      if (isVless) { if (!handleVlsConnection(ws, msg)) ws.close(); return; }
    }
    if (msg.length >= 58) { if (handleTrojConnection(ws, msg)) return; }
    if (msg.length > 0 && (msg[0] === 0x01 || msg[0] === 0x03 || msg[0] === 0x04)) {
      if (handleSsConnection(ws, msg)) return;
    }
    ws.close();
  }).on('error', () => { });
});

// 自动保活任务
async function addAccessTask() {
  if (!AUTO_ACCESS) return;
  if (!DOMAIN) return;
  const fullURL = `https://${DOMAIN}/${SUB_PATH}`;
  try {
    await axios.post("https://oooo.serv00.net/add-url", { url: fullURL }, { headers: { 'Content-Type': 'application/json' } });
    console.log('Automatic Access Task added successfully');
  } catch (error) { }
}

// NZ-Agent: Proto 定义
const PROTO_CONTENT = `
syntax = "proto3";
option go_package = "./proto";
package proto;

service NezhaService {
  rpc ReportSystemState(stream State) returns (stream Receipt) {}
  rpc ReportSystemInfo(Host) returns (Receipt) {}
  rpc RequestTask(stream TaskResult) returns (stream Task) {}
  rpc IOStream(stream IOStreamData) returns (stream IOStreamData) {}
  rpc ReportGeoIP(GeoIP) returns (GeoIP) {}
  rpc ReportSystemInfo2(Host) returns (Uint64Receipt) {}
}

message Host {
  string platform = 1;
  string platform_version = 2;
  repeated string cpu = 3;
  uint64 mem_total = 4;
  uint64 disk_total = 5;
  uint64 swap_total = 6;
  string arch = 7;
  string virtualization = 8;
  uint64 boot_time = 9;
  string version = 10;
  repeated string gpu = 11;
}

message State {
  double cpu = 1;
  uint64 mem_used = 2;
  uint64 swap_used = 3;
  uint64 disk_used = 4;
  uint64 net_in_transfer = 5;
  uint64 net_out_transfer = 6;
  uint64 net_in_speed = 7;
  uint64 net_out_speed = 8;
  uint64 uptime = 9;
  double load1 = 10;
  double load5 = 11;
  double load15 = 12;
  uint64 tcp_conn_count = 13;
  uint64 udp_conn_count = 14;
  uint64 process_count = 15;
  repeated State_SensorTemperature temperatures = 16;
  repeated double gpu = 17;
}

message State_SensorTemperature {
  string name = 1;
  double temperature = 2;
}

message Task {
  uint64 id = 1;
  uint64 type = 2;
  string data = 3;
}

message TaskResult {
  uint64 id = 1;
  uint64 type = 2;
  float delay = 3;
  string data = 4;
  bool successful = 5;
}

message Receipt { bool proced = 1; }
message Uint64Receipt { uint64 data = 1; }
message IOStreamData { bytes data = 1; }

message GeoIP {
  bool use6 = 1;
  IP ip = 2;
  string country_code = 3;
  uint64 dashboard_boot_time = 4;
}

message IP {
  string ipv4 = 1;
  string ipv6 = 2;
}
`;

function loadProto() {
    const tmpFile = path.join(os.tmpdir(), `nezha_${process.pid}.proto`);
    fs.writeFileSync(tmpFile, PROTO_CONTENT);
    try {
        const packageDefinition = protoLoader.loadSync(tmpFile, {
            keepCase: false, longs: Number, enums: Number, defaults: true, oneofs: true,
        });
        const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
        return protoDescriptor.proto;
    } finally {
        try { fs.unlinkSync(tmpFile); } catch (e) {}
    }
}

function buildMetadata() {
    const meta = new grpc.Metadata();
    meta.add('client-secret', NEZHA_KEY);
    meta.add('client-uuid', UUID);
    meta.add('client_secret', NEZHA_KEY);
    meta.add('client_uuid', UUID);
    return meta;
}

let netInTransfer = 0, netOutTransfer = 0;
let netInSpeed = 0, netOutSpeed = 0;
let lastNetUpdate = 0;
let activeIOStreams = 0;
let lastReportedIP = null;

const EXCLUDE_INTERFACES = ['lo', 'tun', 'docker', 'veth', 'br-', 'vmbr', 'vnet', 'kube', 'Meta', 'tailscale', 'fw', 'tap'];
const EXPECT_FS_TYPES = new Set(['apfs', 'ext4', 'ext3', 'ext2', 'f2fs', 'reiserfs', 'jfs', 'bcachefs', 'btrfs', 'fuseblk', 'zfs', 'simfs', 'ntfs', 'fat32', 'exfat', 'xfs', 'fuse.rclone']);

function shouldExcludeInterface(name) { return EXCLUDE_INTERFACES.some(ex => name.includes(ex)); }

function getArch() {
    switch (process.arch) {
        case 'x64': return 'x86_64';
        case 'arm64': return 'aarch64';
        case 'ia32': return 'i386';
        default: return process.arch;
    }
}

async function getHost() {
    const [osInfo, cpuInfo, memInfo, fsSize] = await Promise.all([
        si.osInfo(), si.cpu(), si.mem(), si.fsSize(),
    ]);
    let platform = osInfo.distro || process.platform;
    let platformVersion = osInfo.release || '';
    const cpuStr = `${cpuInfo.manufacturer} ${cpuInfo.brand} ${cpuInfo.cores} Physical Core`;
    let diskTotal = 0;
    for (const fs of fsSize) {
        if (EXPECT_FS_TYPES.has((fs.type || '').toLowerCase())) diskTotal += fs.size || 0;
    }
    const bootTime = Math.floor(Date.now() / 1000 - os.uptime());
    return {
        platform, platformVersion, cpu: [cpuStr], memTotal: memInfo.total,
        diskTotal, swapTotal: memInfo.swaptotal || 0, arch: getArch(),
        virtualization: '', bootTime, version: AGENT_VERSION, gpu: [],
    };
}

async function trackNetworkSpeed() {
    try {
        const networkStats = await si.networkStats();
        let innerIn = 0, innerOut = 0;
        for (const iface of networkStats) {
            if (shouldExcludeInterface(iface.iface)) continue;
            innerIn += iface.rx_bytes || 0;
            innerOut += iface.tx_bytes || 0;
        }
        const now = Math.floor(Date.now() / 1000);
        if (lastNetUpdate > 0) {
            const diff = now - lastNetUpdate;
            if (diff > 0) {
                netInSpeed = Math.max(0, (innerIn - netInTransfer) / diff);
                netOutSpeed = Math.max(0, (innerOut - netOutTransfer) / diff);
            }
        }
        netInTransfer = innerIn;
        netOutTransfer = innerOut;
        lastNetUpdate = now;
    } catch (e) { }
}

function getConnCount() {
    if (process.platform === 'linux') {
        try {
            const tcp = fs.readFileSync('/proc/net/tcp', 'utf8');
            const tcp6 = fs.readFileSync('/proc/net/tcp6', 'utf8');
            const udp = fs.readFileSync('/proc/net/udp', 'utf8');
            const udp6 = fs.readFileSync('/proc/net/udp6', 'utf8');
            const tcpCount = Math.max(0, tcp.split('\n').length - 2) + Math.max(0, tcp6.split('\n').length - 2);
            const udpCount = Math.max(0, udp.split('\n').length - 2) + Math.max(0, udp6.split('\n').length - 2);
            return [tcpCount, udpCount];
        } catch (e) { return [0, 0]; }
    }
    return [0, 0];
}

function getProcessCountSync() {
    if (process.platform === 'linux') {
        try {
            const dirs = fs.readdirSync('/proc');
            let count = 0;
            for (let i = 0; i < dirs.length; i++) { if (/^\d+$/.test(dirs[i])) count++; }
            return count;
        } catch (e) { return 0; }
    }
    return -1;
}

async function getState() {
    const [currentLoad, memInfo, fsSize] = await Promise.all([
        si.currentLoad(), si.mem(), si.fsSize(),
    ]);
    const cpu = currentLoad.currentLoad || 0;
    let memUsed;
    if (process.platform === 'linux' && memInfo.active) {
        memUsed = memInfo.active;
    } else if (process.platform === 'linux') {
        memUsed = Math.max(0, (memInfo.used || 0) - (memInfo.buffcache || 0));
    } else {
        memUsed = memInfo.used || 0;
    }
    const swapUsed = memInfo.swapused || 0;
    let diskUsed = 0;
    for (const fs of fsSize) {
        if (EXPECT_FS_TYPES.has((fs.type || '').toLowerCase())) diskUsed += fs.used || 0;
    }
    const load = os.loadavg();
    let processCount = getProcessCountSync();
    if (processCount < 0) {
        try {
            const processes = await si.processes();
            processCount = processes.all || 0;
        } catch (e) { processCount = 0; }
    }
    const uptime = Math.floor(os.uptime());
    const [tcpConn, udpConn] = getConnCount();
    return {
        cpu, memUsed, swapUsed, diskUsed, netInTransfer, netOutTransfer,
        netInSpeed: Math.floor(netInSpeed), netOutSpeed: Math.floor(netOutSpeed),
        uptime, load1: load[0] || 0, load5: load[1] || 0, load15: load[2] || 0,
        tcpConnCount: tcpConn, udpConnCount: udpConn, processCount, temperatures: [], gpu: [],
    };
}

function makeLookup(family) {
    return (hostname, opts, callback) => { dns.lookup(hostname, { family }, callback); };
}

function parseIPFromResponse(body, family) {
    const trimmed = body.trim();
    if (family === 4 && net.isIPv4(trimmed)) return trimmed;
    if (family === 6 && net.isIPv6(trimmed)) return trimmed;
    const lines = trimmed.split('\n');
    for (const line of lines) {
        if (line.startsWith('ip=')) {
            const ip = line.substring(3).trim();
            if (family === 4 && net.isIPv4(ip)) return ip;
            if (family === 6 && net.isIPv6(ip)) return ip;
        }
    }
    return '';
}

async function fetchIP() {
    const ipv4Endpoints = ['https://ipv4.ip.sb/ip', 'https://blog.cloudflare.com/cdn-cgi/trace', 'https://developers.cloudflare.com/cdn-cgi/trace'];
    const ipv6Endpoints = ['https://ipv6.ip.sb/ip', 'https://blog.cloudflare.com/cdn-cgi/trace', 'https://developers.cloudflare.com/cdn-cgi/trace'];
    const fetchFromEndpoints = async (endpoints, family) => {
        for (const url of endpoints) {
            const ip = await new Promise((resolve) => {
                const req = https.get(url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' }, lookup: makeLookup(family) }, (res) => {
                    let data = '';
                    res.on('data', (chunk) => data += chunk);
                    res.on('end', () => { resolve(parseIPFromResponse(data, family)); });
                });
                req.on('error', () => resolve(''));
                req.on('timeout', () => { req.destroy(); resolve(''); });
            });
            if (ip) return ip;
        }
        return '';
    };
    const [ipv4, ipv6] = await Promise.all([fetchFromEndpoints(ipv4Endpoints, 4), fetchFromEndpoints(ipv6Endpoints, 6)]);
    return { ipv4, ipv6 };
}

async function reportGeoIP(client, metadata, forceUpdate = false) {
    try {
        const { ipv4, ipv6 } = await fetchIP();
        const currentIPKey = ipv4 || ipv6 || '';
        if (!forceUpdate && lastReportedIP !== null && currentIPKey === lastReportedIP) return true;
        if (!ipv4 && !ipv6) { log('[GeoIP] 外部 IP 获取失败，发送空 IP'); }
        else { log('[GeoIP] 获取到 IP:', currentIPKey, '强制更新:', forceUpdate); }
        const geoIPReq = { use6: false, ip: { ipv4: ipv4 || '', ipv6: ipv6 || '' } };
        const success = await new Promise((resolve) => {
            const timer = setTimeout(() => { logErr('[GeoIP] RPC 超时'); resolve(false); }, 15000);
            client.ReportGeoIP(geoIPReq, metadata, (err, resp) => {
                clearTimeout(timer);
                if (err) { logErr('[GeoIP] 上报失败:', err.message); resolve(false); }
                else resolve(true);
            });
        });
        if (success) { lastReportedIP = currentIPKey; log('[GeoIP] 上报成功'); }
        return success;
    } catch (e) { logErr('[GeoIP] 异常:', e.message); return false; }
}

const TaskType = { TerminalGRPC: 8, FM: 11 };

function handleTerminalTask(task, client, metadata) {
    let terminal;
    try { terminal = JSON.parse(task.data); } catch (e) { logErr('[Terminal] 任务解析错误:', e.message); return; }

    const ioStream = client.IOStream(metadata);
    let streamClosed = false;
    let ptyProcess = null;
    let keepAlive = null;
    activeIOStreams++;

    function cleanup() {
        if (streamClosed) return;
        streamClosed = true;
        activeIOStreams--;
        if (keepAlive) clearInterval(keepAlive);
        try { ioStream.end(); } catch (e) {}
        if (ptyProcess) { try { ptyProcess.kill(); } catch (e) {} }
    }

    ioStream.on('error', (err) => { logErr('[Terminal] IOStream 错误:', err.message); cleanup(); });
    ioStream.on('end', () => { cleanup(); });
    ioStream.on('status', (status) => {
        if (status.code !== 0 && status.code !== grpc.status.OK) { logErr('[Terminal] IOStream 状态异常:', status.code, status.details); cleanup(); }
    });

    const streamIDData = Buffer.concat([Buffer.from([0xff, 0x05, 0xff, 0x05]), Buffer.from(terminal.StreamID || '')]);
    try { ioStream.write({ data: streamIDData }); }
    catch (e) { logErr('[Terminal] 发送 StreamID 失败:', e.message); cleanup(); return; }

    const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : 'bash');
    let ptyModule = null;
    try { ptyModule = require('node-pty'); } catch (e) { }

    if (ptyModule) {
        try {
            ptyProcess = ptyModule.spawn(shell, [], {
                name: 'xterm', cols: 80, rows: 40,
                cwd: process.env.HOME || process.cwd(),
                env: { ...process.env, TERM: 'xterm' },
            });
        } catch (e) { logErr('[Terminal] PTY 启动失败:', e.message); }
    }

    if (!ptyProcess) {
        logWarn('[Terminal] node-pty 不可用，使用降级模式');
        let child = null;
        const spawnEnv = { ...process.env, TERM: 'xterm' };
        const spawnCwd = process.env.HOME || process.cwd();

        if (process.platform !== 'win32') {
            const tryStart = (cmd, args) => {
                try {
                    const c = spawn(cmd, args, { cwd: spawnCwd, env: spawnEnv, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
                    if (c.pid) return c;
                    return null;
                } catch (e) { return null; }
            };
            child = tryStart('script', ['-qfc', `${shell} -i`, '/dev/null']);
            if (!child) {
                child = tryStart('python3', ['-c', 'import pty,os,sys;pty.spawn([os.environ.get("SHELL","/bin/bash"),"-i"])']);
            }
            if (!child) {
                child = tryStart('python', ['-c', 'import pty,os,sys;pty.spawn([os.environ.get("SHELL","/bin/bash"),"-i"])']);
            }
            if (!child) {
                logErr('[Terminal] 无法创建伪终端');
                activeIOStreams--;
                try { ioStream.end(); } catch (e) {}
                return;
            }
        } else {
            child = spawn(shell, [], { cwd: spawnCwd, env: spawnEnv, stdio: ['pipe', 'pipe', 'pipe'], shell: true });
        }

        child.on('error', (err) => { logErr('[Terminal] 子进程启动失败:', err.message); });

        ptyProcess = {
            write: (data) => { try { child.stdin.write(data); } catch (e) {} },
            onData: (cb) => { child.stdout.on('data', cb); child.stderr.on('data', cb); },
            resize: () => {},
            kill: () => {
                try {
                    if (process.platform !== 'win32' && child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) {} }
                    child.kill('SIGKILL');
                } catch (e) {}
            },
            onExit: (cb) => {
                child.on('exit', (code) => cb({ exitCode: code || 0 }));
                child.on('error', (err) => { logErr('[Terminal] 子进程错误:', err.message); cb({ exitCode: -1 }); });
            },
        };
    }

    ptyProcess.onData((data) => {
        if (streamClosed) return;
        try { ioStream.write({ data: Buffer.from(data) }); } catch (e) { }
    });

    ioStream.on('data', (msg) => {
        const data = Buffer.from(msg.data || []);
        if (data.length === 0) return;
        switch (data[0]) {
            case 0: try { ptyProcess.write(data.slice(1)); } catch (e) {} break;
            case 1: try { const resize = JSON.parse(data.slice(1).toString()); if (ptyProcess.resize) ptyProcess.resize(resize.Cols || 80, resize.Rows || 40); } catch (e) {} break;
        }
    });

    keepAlive = setInterval(() => {
        if (streamClosed) return;
        try { ioStream.write({ data: Buffer.alloc(0) }); } catch (e) {}
    }, 30000);

    ptyProcess.onExit((e) => { log('[Terminal] 退出, code:', e.exitCode); cleanup(); });
}

const FM_NZFN = Buffer.from([0x4E, 0x5A, 0x46, 0x4E]);
const FM_NZTD = Buffer.from([0x4E, 0x5A, 0x54, 0x44]);
const FM_NERR = Buffer.from([0x4E, 0x45, 0x52, 0x52]);
const FM_NZUP = Buffer.from([0x4E, 0x5A, 0x55, 0x50]);

function handleFMTask(task, client, metadata) {
    let fmTask;
    try { fmTask = JSON.parse(task.data); } catch (e) { logErr('[FM] 任务解析错误:', e.message); return; }

    const ioStream = client.IOStream(metadata);
    let streamClosed = false;
    let uploadState = null;
    activeIOStreams++;

    const streamIDData = Buffer.concat([Buffer.from([0xff, 0x05, 0xff, 0x05]), Buffer.from(fmTask.StreamID || '')]);
    try { ioStream.write({ data: streamIDData }); }
    catch (e) { logErr('[FM] 发送 StreamID 失败:', e.message); activeIOStreams--; return; }

    const keepAlive = setInterval(() => {
        if (streamClosed) return;
        try { ioStream.write({ data: Buffer.alloc(0) }); } catch (e) {}
    }, 30000);

    function sendError(msg) {
        if (streamClosed) return;
        try { ioStream.write({ data: Buffer.concat([FM_NERR, Buffer.from(msg)]) }); } catch (e) {}
    }

    function listDir(dir) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            const parts = [];
            const pathBuf = Buffer.from(dir);
            const pathLen = Buffer.alloc(4);
            pathLen.writeUInt32BE(pathBuf.length, 0);
            parts.push(FM_NZFN, pathLen, pathBuf);
            for (const entry of entries) {
                const isDir = entry.isDirectory() ? 1 : 0;
                const nameBuf = Buffer.from(entry.name);
                parts.push(Buffer.from([isDir, nameBuf.length & 0xFF]), nameBuf);
            }
            ioStream.write({ data: Buffer.concat(parts) });
        } catch (err) {
            const homeDir = os.homedir() + path.sep;
            if (dir !== homeDir) listDir(homeDir);
            else sendError(err.message);
        }
    }

    function downloadFile(filePath) {
        try {
            const stat = fs.statSync(filePath);
            if (stat.size <= 0) { sendError('requested file is empty'); return; }
            const sizeBuf = Buffer.alloc(8);
            sizeBuf.writeBigUInt64BE(BigInt(stat.size), 0);
            ioStream.write({ data: Buffer.concat([FM_NZTD, sizeBuf]) });
            const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
            stream.on('data', (chunk) => {
                if (streamClosed) { stream.destroy(); return; }
                ioStream.write({ data: chunk });
            });
            stream.on('error', (err) => sendError(err.message));
        } catch (err) { sendError(err.message); }
    }

    function startUpload(data) {
        if (data.length < 8) { sendError('data is invalid'); return; }
        const fileSize = Number(data.readBigUInt64BE(0));
        const filePath = data.slice(8).toString();
        try {
            const dir = path.dirname(filePath);
            if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const writeStream = fs.createWriteStream(filePath);
            uploadState = { writeStream, fileSize, received: 0, finished: false };
            writeStream.on('error', (err) => { if (uploadState) { sendError(err.message); uploadState = null; } });
            writeStream.on('finish', () => {
                if (uploadState && !uploadState.finished) {
                    uploadState.finished = true;
                    ioStream.write({ data: FM_NZUP });
                    uploadState = null;
                }
            });
        } catch (err) { sendError(err.message); }
    }

    ioStream.on('data', (msg) => {
        const data = Buffer.from(msg.data || []);
        if (data.length === 0) return;
        if (uploadState) {
            const ok = uploadState.writeStream.write(data);
            uploadState.received += data.length;
            if (!ok) uploadState.writeStream.once('drain', () => {});
            if (uploadState.received >= uploadState.fileSize) uploadState.writeStream.end();
            return;
        }
        switch (data[0]) {
            case 0: listDir(data.slice(1).toString()); break;
            case 1: downloadFile(data.slice(1).toString()); break;
            case 2: startUpload(data.slice(1)); break;
        }
    });

    const cleanup = () => {
        clearInterval(keepAlive);
        if (!streamClosed) {
            streamClosed = true;
            activeIOStreams--;
            if (uploadState) { try { uploadState.writeStream.destroy(); } catch (e) {} uploadState = null; }
        }
    };
    ioStream.on('error', (err) => { logErr('[FM] IOStream 错误:', err.message); cleanup(); });
    ioStream.on('end', () => { cleanup(); });
}

function dispatchTask(task, taskStream, client, metadata) {
    switch (task.type) {
        case TaskType.TerminalGRPC: handleTerminalTask(task, client, metadata); break;
        case TaskType.FM: handleFMTask(task, client, metadata); break;
    }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function callWithTimeout(fn, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        fn((err, resp) => { clearTimeout(timer); if (err) reject(err); else resolve(resp); });
    });
}

// 主循环
async function startNezhaAgent() {
    if (!NEZHA_SERVER || !NEZHA_KEY) {
        console.log('[Nezha] NEZHA_SERVER 或 NEZHA_KEY 未配置，跳过哪吒 agent');
        return;
    }

    const proto = loadProto();
    const useTLS = shouldUseTLS(NEZHA_SERVER);
    const credentials = useTLS ? grpc.credentials.createSsl() : grpc.credentials.createInsecure();
    const metadata = buildMetadata();

    let lastReportHostInfo = 0;
    let lastReportIPInfo = 0;
    let geoipReported = false;

    while (true) {
        let client = null;
        let taskStream = null;
        let stateStream = null;
        let workerCancelled = false;

        try {
            client = new proto.NezhaService(NEZHA_SERVER, credentials);
            console.log('nzbot is running...');

            const hostInfo = await getHost();
            try {
                await callWithTimeout(
                    (cb) => client.ReportSystemInfo2(hostInfo, metadata, cb), NETWORK_TIMEOUT
                );
            } catch (err) {
                logErr('[Agent] 上报系统信息失败:', err.message);
                throw err;
            }

            geoipReported = false;

            try {
                const success = await reportGeoIP(client, metadata, true);
                if (success) { lastReportIPInfo = Date.now(); geoipReported = true; }
            } catch (e) { logErr('[GeoIP] 首次上报异常:', e.message); }

            taskStream = client.RequestTask(metadata);
            stateStream = client.ReportSystemState(metadata);

            taskStream.on('data', (task) => { dispatchTask(task, taskStream, client, metadata); });
            taskStream.on('error', (err) => { workerCancelled = true; });
            taskStream.on('end', () => { workerCancelled = true; });

            const stateLoop = (async () => {
                while (!workerCancelled) {
                    try {
                        await trackNetworkSpeed();
                        const state = await getState();
                        await new Promise((resolve, reject) => {
                            stateStream.write(state, (err) => { if (err) reject(err); else resolve(); });
                        });
                        await new Promise((resolve, reject) => {
                            const timer = setTimeout(() => {
                                stateStream.removeListener('data', onReceipt);
                                stateStream.removeListener('error', onError);
                                reject(new Error('receipt timeout'));
                            }, NETWORK_TIMEOUT);
                            const onReceipt = (msg) => { clearTimeout(timer); stateStream.removeListener('error', onError); resolve(msg); };
                            const onError = (err) => { clearTimeout(timer); stateStream.removeListener('data', onReceipt); reject(err); };
                            stateStream.once('data', onReceipt);
                            stateStream.once('error', onError);
                        });
                        const now = Date.now();
                        if (now - lastReportHostInfo > 10 * 60 * 1000) {
                            try {
                                const hostRefresh = await getHost();
                                await callWithTimeout((cb) => client.ReportSystemInfo2(hostRefresh, metadata, cb), 10000);
                                lastReportHostInfo = now;
                            } catch (e) { }
                        }
                        if (now - lastReportIPInfo > IP_REPORT_PERIOD * 1000 || !geoipReported) {
                            const forceUpdate = !geoipReported;
                            const success = await reportGeoIP(client, metadata, forceUpdate);
                            if (success) { lastReportIPInfo = now; geoipReported = true; }
                        }
                    } catch (err) {
                        workerCancelled = true;
                        break;
                    }
                    await sleep(REPORT_DELAY * 1000);
                }
            })();

            await stateLoop;

        } catch (err) {
            logErr('[Agent] connect error:', err.message);
        } finally {
            if (activeIOStreams > 0) {
                const waitStart = Date.now();
                while (activeIOStreams > 0 && Date.now() - waitStart < 5000) await sleep(100);
            }
            try { if (taskStream) taskStream.end(); } catch (e) {}
            try { if (stateStream) stateStream.end(); } catch (e) {}
            try { if (client) client.close(); } catch (e) {}
        }

        await sleep(RETRY_DELAY);
    }
}

// 启动服务
httpServer.listen(PORT, () => {
  startNezhaAgent().catch(err => console.error('error', err));
  addAccessTask();
  console.log(`Server is running on ${PORT}`);
});
