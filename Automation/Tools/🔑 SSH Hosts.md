# SSH File

```
Host hkust-gz
  HostName 10.120.16.48
  User wangtianfu
  # Password: wangtianfu123
  # 一切东西（包括conda安装等）请放在/home/data/{username}

Host aliyun
  HostName 39.105.222.125
  User root
  IdentityFile ~/.ssh/id_ed25519

Host ms-8h20
  HostName 118.195.243.124
  User ubuntu
  IdentityFile ~/.ssh/id_ed25519
  # tHC2Fd%5#fg^3

Host ms-8h20-b
  HostName 119.45.132.43
  User ubuntu
  IdentityFile ~/.ssh/id_ed25519
  # L~2]tBA#Me@3K6cQ

Host ms-8h20-183
  HostName 146.56.200.183
  User ubuntu
  # IdentityFile ~/.ssh/id_ed25519
  # $CNxs9W@y*w4J)

Host ms-8h20-233
  HostName 146.56.222.223
  User ubuntu
  IdentityFile ~/.ssh/id_ed25519
  # $CNxs9W@y*w4J)

Host ms-nft2b-a100
  HostName 57.152.82.155
  # HostName 172.174.146.194
  User azureuser
  IdentityFile ~/document/key/server/ms-nft2b-aigc.pem
  # ProxyCommand nc -X 5 -x 127.0.0.1:1080 %h %p


Host ali-light
  HostName 47.74.13.87
  User root
  IdentityFile ~/.ssh/id_ed25519

Host ustc-bdaa
  HostName 222.195.93.60
  User tfwang
  Port 1641
  ProxyCommand nc -x 127.0.0.1:1080 %h %p
  # ProxyCommand ssh -W %h:%p local-proxy

Host ms-ai4nft-a100
  HostName 20.62.44.48
  User ai4nft

Host msra-gcr
  HostName GCRAZGDL3169.westus2.cloudapp.azure.com
  IdentityFile ~/.ssh/id_ed25519
  User v-wangtianfu@microsoft.com
  # ssh -i ~/.ssh/id_ed25519 v-wangtianfu@microsoft.com@GCRAZGDL3122.westus2.cloudapp.azure.com
```
