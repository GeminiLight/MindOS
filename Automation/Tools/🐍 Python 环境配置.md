# 🐍 Python 环境配置

适用于 Mac 和 Linux 服务器，按平台选择对应步骤。

## 1️⃣ 安装 Miniconda

**Mac**

```bash
brew install --cask miniconda
```

**Linux（服务器）**

```bash
wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh
bash Miniconda3-latest-Linux-x86_64.sh -b -p ~/miniconda3
~/miniconda3/bin/conda init zsh   # 或 bash
source ~/.zshrc
```

验证：`conda info`

## 2️⃣ 安装 uv

**Mac / Linux（推荐）**

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

**Mac（Homebrew）**

```bash
brew install uv
```

验证：`uv --version`

## 3️⃣ 配置镜像源（无代理时使用）

**pip**

```bash
pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple
pip config set global.trusted-host pypi.tuna.tsinghua.edu.cn
```

**uv**

```bash
echo 'export UV_DEFAULT_INDEX="https://pypi.tuna.tsinghua.edu.cn/simple"' >> ~/.zshrc
source ~/.zshrc
```

## 4️⃣ 创建默认 conda 环境

```bash
conda create -n base python=3.11 -y
conda activate base
pip install numpy pandas torch jupyter ipykernel
```

## 5️⃣ 创建 LLM 开发环境

```bash
conda create -n llm python=3.11 -y
conda activate llm
pip install \
  numpy pandas torch jupyter ipykernel \
  transformers datasets accelerate \
  langchain langchain-community langchain-openai \
  openai anthropic \
  sentence-transformers \
  pydantic python-dotenv \
  tqdm rich
```
