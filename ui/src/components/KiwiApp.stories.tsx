import type { Meta, StoryObj } from "@storybook/react";
import { KiwiApp } from "./KiwiApp";

const meta: Meta<typeof KiwiApp> = {
  title: "Blocks/KiwiApp",
  component: KiwiApp,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-3xl p-4 bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KiwiApp>;

export const InteractiveCounter: Story = {
  args: {
    source: `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: system-ui, sans-serif; padding: 24px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
    h2 { margin: 0; color: #1a1a1a; }
    .counter { font-size: 3rem; font-weight: bold; color: #3b82f6; }
    .buttons { display: flex; gap: 12px; }
    button { padding: 8px 20px; font-size: 1rem; border: 1px solid #e5e7eb; border-radius: 6px; cursor: pointer; transition: all 0.15s; }
    button:hover { background: #f3f4f6; }
    button:active { transform: scale(0.95); }
    .decrement { color: #ef4444; }
    .increment { color: #22c55e; }
  </style>
</head>
<body>
  <h2>Interactive Counter</h2>
  <div class="counter" id="count">0</div>
  <div class="buttons">
    <button class="decrement" onclick="update(-1)">- Decrease</button>
    <button class="increment" onclick="update(1)">+ Increase</button>
  </div>
  <script>
    let count = 0;
    function update(delta) {
      count += delta;
      document.getElementById('count').textContent = count;
    }
  </script>
</body>
</html>`,
  },
};

export const CSSAnimation: Story = {
  args: {
    source: `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: system-ui; padding: 24px; text-align: center; }
    .box-container { display: flex; justify-content: center; gap: 20px; margin-top: 20px; }
    .box { width: 60px; height: 60px; border-radius: 8px; animation: bounce 1.5s ease-in-out infinite; }
    .box:nth-child(1) { background: #3b82f6; animation-delay: 0s; }
    .box:nth-child(2) { background: #8b5cf6; animation-delay: 0.2s; }
    .box:nth-child(3) { background: #ec4899; animation-delay: 0.4s; }
    .box:nth-child(4) { background: #f59e0b; animation-delay: 0.6s; }
    @keyframes bounce {
      0%, 100% { transform: translateY(0) scale(1); }
      50% { transform: translateY(-20px) scale(1.1); }
    }
    h3 { margin: 0; color: #374151; }
    p { color: #6b7280; font-size: 14px; }
  </style>
</head>
<body>
  <h3>CSS Animation Playground</h3>
  <p>Pure CSS bouncing boxes with staggered delays</p>
  <div class="box-container">
    <div class="box"></div>
    <div class="box"></div>
    <div class="box"></div>
    <div class="box"></div>
  </div>
</body>
</html>`,
  },
};

export const MiniTodoApp: Story = {
  args: {
    source: `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: system-ui; padding: 20px; max-width: 400px; margin: 0 auto; }
    h3 { margin: 0 0 12px; }
    .input-row { display: flex; gap: 8px; margin-bottom: 16px; }
    input { flex: 1; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; }
    input:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59,130,246,0.1); }
    button { padding: 8px 16px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
    button:hover { background: #2563eb; }
    ul { list-style: none; padding: 0; margin: 0; }
    li { display: flex; align-items: center; gap: 8px; padding: 8px; border-bottom: 1px solid #f3f4f6; }
    li.done span { text-decoration: line-through; color: #9ca3af; }
    .check { cursor: pointer; width: 18px; height: 18px; }
    .empty { color: #9ca3af; font-size: 13px; text-align: center; padding: 20px; }
  </style>
</head>
<body>
  <h3>Mini Todo</h3>
  <div class="input-row">
    <input id="input" placeholder="Add a task..." onkeydown="if(event.key==='Enter')add()" />
    <button onclick="add()">Add</button>
  </div>
  <ul id="list"></ul>
  <div class="empty" id="empty">No tasks yet. Add one above!</div>
  <script>
    const list = document.getElementById('list');
    const empty = document.getElementById('empty');
    function add() {
      const input = document.getElementById('input');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      const li = document.createElement('li');
      li.innerHTML = '<input type="checkbox" class="check" onchange="toggle(this)"><span>' + text + '</span>';
      list.appendChild(li);
      empty.style.display = 'none';
    }
    function toggle(cb) {
      cb.parentElement.classList.toggle('done', cb.checked);
    }
  </script>
</body>
</html>`,
    meta: "height=280",
  },
};

export const ThemeAware: Story = {
  args: {
    source: `<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: system-ui;
      padding: 24px;
      /* Uses CSS vars forwarded from the parent kiwifs theme */
      background: var(--background, #ffffff);
      color: var(--foreground, #1a1a1a);
    }
    .card {
      border: 1px solid var(--border, #e5e7eb);
      border-radius: 8px;
      padding: 16px;
      margin-top: 12px;
    }
    .card h4 { margin: 0 0 8px; }
    .card p { margin: 0; opacity: 0.7; font-size: 14px; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 12px;
      background: var(--accent, #f3f4f6);
      color: var(--accent-foreground, #374151);
    }
  </style>
</head>
<body>
  <h3>Theme-Aware App</h3>
  <p>This app inherits CSS variables from the kiwifs parent theme.</p>
  <div class="card">
    <h4>Inherited Theme</h4>
    <p>Toggle dark/light mode in Storybook toolbar to see this adapt.</p>
    <br/>
    <span class="badge">theme-forwarded</span>
  </div>
</body>
</html>`,
  },
};

export const FixedHeight: Story = {
  args: {
    source: `<h2 style="font-family:system-ui; text-align:center; padding:40px;">
  Fixed height iframe (200px)
</h2>`,
    meta: "height=200",
  },
};
