# 🤗 HuggingFace 配置

## 配置镜像源（无代理时使用）

```bash
grep -qxF 'export HF_ENDPOINT=https://hf-mirror.com' ~/.zshrc || echo 'export HF_ENDPOINT=https://hf-mirror.com' >> ~/.zshrc
source ~/.zshrc
```

Linux 服务器将 `~/.zshrc` 替换为 `~/.bashrc`。

## 登录 HuggingFace（访问私有模型/数据集）

```bash
pip install huggingface_hub
huggingface-cli login
```

输入 Access Token（从 https://huggingface.co/settings/tokens 获取）。
