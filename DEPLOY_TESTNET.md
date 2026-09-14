# Deploy lên Testnet thật (Arbitrum Sepolia / Base Sepolia)

**Cảnh báo an toàn quan trọng nhất**: KHÔNG BAO GIỜ dán private key vào chat với AI, vào
issue GitHub, hay commit vào git — kể cả private key ví testnet (thói quen dùng lại ví là
nguồn rò rỉ phổ biến nhất). Toàn bộ hướng dẫn dưới đây bạn tự chạy trên máy mình, key chỉ
nằm trong file `contracts/.env` (đã có trong `.gitignore`, không bao giờ lên git).

---

## 0. Chuẩn bị 2 thứ bắt buộc

### 0a. Ví deployer + testnet ETH

**Khuyến nghị: tạo 1 ví MỚI chỉ dùng cho việc này**, không dùng lại ví có tiền thật hay ví
chính của bạn — private key này sẽ nằm trên máy dev suốt quá trình phát triển.

Cách tạo nhanh 1 ví mới (không cần MetaMask, chạy ngay trong `contracts/`):

```bash
cd contracts
node -e "const {ethers}=require('ethers'); const w=ethers.Wallet.createRandom(); console.log('Address:', w.address); console.log('Private key:', w.privateKey);"
```

Lưu lại `Address` và `Private key` — **chỉ bạn giữ, không gửi cho ai kể cả tôi**.

Xin testnet ETH miễn phí (faucet). **Lưu ý**: nhiều faucet lớn (Alchemy, GetBlock...) bắt
buộc ví bạn phải có sẵn ETH thật trên mainnet (chống spam) — nếu bạn chưa có, dùng đúng
các faucet KHÔNG yêu cầu mainnet dưới đây:

| Network | Faucet KHÔNG cần mainnet ETH | Ghi chú |
|---|---|---|
| Arbitrum Sepolia | https://faucet.quicknode.com/arbitrum/sepolia | Không cần tài khoản/đăng nhập, 1 lần/12h/mạng |
| Arbitrum Sepolia | https://faucets.chain.link/arbitrum-sepolia | Faucet chính thức Chainlink, chỉ cần connect ví |
| Arbitrum Sepolia | https://l2faucet.com/arbitrum | Xác minh qua "device attestation", không cần bridge/mạng xã hội |
| Base Sepolia | https://faucet.quicknode.com/base/sepolia | Giống trên |
| Base Sepolia | https://docs.base.org/base-chain/network-information/network-faucets | Trang chính thức Base, liệt kê cả Coinbase Developer Platform Faucet (tới 0.1 ETH/24h) |

Cách khác nếu các faucet trên hết lượt: xin **Ethereum Sepolia** (L1) ETH ở
https://faucets.chain.link/sepolia hoặc https://cloud.google.com/application/web3/faucet/ethereum/sepolia
(cũng không cần mainnet), rồi bridge sang L2 qua cầu chính thức:
- Arbitrum: https://bridge.arbitrum.io (chọn Sepolia → Arbitrum Sepolia)
- Base: https://bridge.base.org (chọn Sepolia → Base Sepolia)

Cần ~0.05 ETH testnet là đủ deploy toàn bộ (Vault + StrategyManager + Strategy +
RebalanceTimelock, ~5-6 giao dịch) — faucet QuickNode/Chainlink thường cho 0.01-0.1 ETH/lần
nên có thể cần xin 1-2 lần cách nhau vài giờ (giới hạn rate-limit theo ví/IP).

### 0b. RPC URL

Dùng RPC provider có API key riêng (KHÔNG dùng RPC công khai cho việc deploy thật — dễ bị
rate-limit giữa chừng khi đang deploy dở):

1. Tạo tài khoản miễn phí tại [Alchemy](https://www.alchemy.com/) hoặc [Infura](https://www.infura.io/).
2. Tạo app mới, chọn đúng network `Arbitrum Sepolia` và/hoặc `Base Sepolia`.
3. Copy URL dạng `https://arb-sepolia.g.alchemy.com/v2/<api-key>` (hoặc tương tự của Infura).

---

## 1. Điền `contracts/.env`

```bash
cd contracts
cp .env.example .env   # nếu chưa có sẵn .env
```

Mở `contracts/.env`, điền:

```
ARBITRUM_SEPOLIA_RPC_URL=https://arb-sepolia.g.alchemy.com/v2/<api-key-cua-ban>
BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/<api-key-cua-ban>
DEPLOYER_PRIVATE_KEY=<private-key-tu-buoc-0a>
```

Chỉ điền `RPC_URL` của network bạn thực sự deploy (không bắt buộc điền cả 2 nếu chỉ làm 1
chain).

Các biến còn lại trong `contracts/.env` — để trống là hợp lệ cho lần deploy đầu tiên (dùng
mặc định an toàn), xem giải thích ở bước 4 nếu muốn bật thêm tính năng.

---

## 2. Kiểm tra ví đã có ETH trước khi deploy (tránh deploy dở dang giữa chừng)

```bash
cd contracts
node -e "
const {ethers} = require('ethers');
require('dotenv').config();
(async () => {
  const provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_SEPOLIA_RPC_URL);
  const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  const balance = await provider.getBalance(wallet.address);
  console.log('Address:', wallet.address);
  console.log('Balance:', ethers.formatEther(balance), 'ETH');
})();
"
```

Đổi `ARBITRUM_SEPOLIA_RPC_URL` thành `BASE_SEPOLIA_RPC_URL` nếu deploy Base Sepolia. Balance
phải > 0 mới tiếp tục — nếu = 0, faucet chưa gửi tới hoặc gửi sai địa chỉ.

---

## 3. Deploy

### Arbitrum Sepolia

```bash
cd contracts
npx hardhat run scripts/deploy.ts --network arbitrumSepolia
```

### Base Sepolia

```bash
cd contracts
npx hardhat run scripts/deploy.ts --network baseSepolia
```

Mỗi lệnh mất khoảng 1-3 phút (mỗi giao dịch phải chờ block thật xác nhận, không tức thời
như Hardhat local). Script deploy đúng thứ tự: `MockUSDC → Vault → StrategyManager →
MockStrategy (hoặc AaveStrategy nếu bạn set `AAVE_POOL_ADDRESS`/`AAVE_ATOKEN_ADDRESS`) →
RebalanceTimelock`, in ra JSON địa chỉ ở cuối — **lưu lại JSON này**, cần cho bước 5.

> Nếu lệnh báo lỗi giữa chừng (hết ETH, RPC timeout...), **không chạy lại từ đầu ngay** —
> đọc kỹ log xem đã deploy tới bước nào, vì chạy lại `deploy.ts` sẽ deploy contract MỚI
> hoàn toàn (không resume), tốn thêm ETH/gas cho những bước đã deploy thành công trước đó.

---

## 4. Các biến tuỳ chọn nên set TRƯỚC khi deploy testnet thật (khác local)

Không bắt buộc, nhưng khuyến nghị mạnh cho testnet (không còn là "chỉ để học" nữa):

```
# Dùng AaveStrategy thật thay vì MockStrategy giả lập - Aave v3 đã có sẵn trên cả 2 testnet
# này. Địa chỉ chính thức, KHÔNG tự đoán - tra tại https://github.com/bgd-labs/aave-address-book
AAVE_POOL_ADDRESS=
AAVE_ATOKEN_ADDRESS=

# Địa chỉ Safe multisig thật (tạo tại https://app.safe.global, chọn đúng network) - không
# set thì mặc định dùng ví deployer làm proposer của RebalanceTimelock, CHỈ chấp nhận được
# cho thử nghiệm, không nên giữ vậy khi test đủ lâu vì mất hết ý nghĩa của timelock+multisig.
GOVERNANCE_MULTISIG_ADDRESS=

# Địa chỉ EOA riêng lẻ (không phải chung 1 multisig) được cấp quyền pause() khẩn cấp,
# phân cách bởi dấu phẩy - nên set ít nhất 1 địa chỉ khác deployer.
GUARDIAN_ADDRESSES=

# Giới hạn TVL tối đa (đơn vị nhỏ nhất, USDC 6 decimals - "1000000000" = 1000 USDC) -
# NÊN SET cho testnet thật để giới hạn thiệt hại nếu có bug chưa phát hiện.
DEPOSIT_CAP_RAW=1000000000
```

Địa chỉ Aave v3 thật đã tra sẵn từ trước (xem `PLAN.md` nội bộ) cho Arbitrum Sepolia:
Pool `0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff`, USDC
`0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`. Base Sepolia chưa tra — kiểm tra lại tại
`aave-address-book` trước khi dùng, đừng tự đoán địa chỉ.

---

## 5. Sau khi deploy — cập nhật config cho các service khác

### 5a. Frontend

Sửa `frontend/src/lib/deployments.local.json` (đổi tên/nội dung tuỳ ý, hoặc tạo file
riêng `deployments.arbitrumSepolia.json` nếu muốn giữ song song với bản local) với địa chỉ
mới + đúng `chainId` (Arbitrum Sepolia = `421614`, Base Sepolia = `84532`) + đúng `rpcUrl`
(dùng RPC public không cần API key riêng cho phía client, ví dụ
`https://sepolia-rollup.arbitrum.io/rpc`).

### 5b. Indexer / Backend

Sửa `.env` gốc (nếu chạy qua Docker Compose) hoặc `indexer/.env`:

```
RPC_URL=<RPC cua network vua deploy>
CHAIN_ID=421614   # hoặc 84532 cho Base Sepolia
VAULT_ADDRESS=<dia chi vault vua deploy>
STRATEGY_MANAGER_ADDRESS=<dia chi strategyManager vua deploy>
CONFIRMATIONS=3   # testnet thật nên giữ >=3, khác local (1 là đủ vì không có reorg)
```

### 5c. Verify trên block explorer

Kiểm tra contract đã lên chain thật (không chỉ tin vào log terminal):

- Arbitrum Sepolia: `https://sepolia.arbiscan.io/address/<vault-address>`
- Base Sepolia: `https://sepolia.basescan.org/address/<vault-address>`

---

## 6. Nếu deploy CẢ 2 testnet (chuẩn bị cho GĐ6.2 cross-chain CCIP)

Sau khi deploy xong CẢ Arbitrum Sepolia lẫn Base Sepolia riêng lẻ theo bước 3, cần thêm 1
bước nối 2 chain lại với nhau — **chưa có script tự động cho việc này**, phải làm thủ công
qua Hardhat console hoặc 1 script nhỏ, vì cần địa chỉ `CrossChainExecutor` của CẢ 2 chain
(chỉ biết được sau khi cả 2 đã deploy xong):

1. Deploy có set thêm `CCIP_ROUTER_ADDRESS` (địa chỉ Router CCIP thật của từng chain, tra
   tại https://docs.chain.link/ccip/directory) và `CCIP_ASSET_ADDRESS` (token CCIP hỗ trợ
   thật — testnet chưa có TokenPool cho MockUSDC tự deploy, cần dùng token demo
   `CCIP-BnM` mà Chainlink cung cấp sẵn trên các testnet, tra cùng trang directory) trong
   `contracts/.env` TRƯỚC khi deploy — nếu không set, script tự bỏ qua bước deploy
   `CrossChainExecutor`.
2. Sau khi có địa chỉ `CrossChainExecutor` của cả 2 chain, gọi `setPeer()` chéo nhau (2
   giao dịch, mỗi chain 1 lần) — tôi có thể viết sẵn 1 script `wire-cross-chain-peers.ts`
   khi bạn tới bước này, chưa cần làm ngay.

---

## 7. Sự cố thường gặp khi deploy testnet thật (khác local)

- **`insufficient funds for gas`**: ví chưa đủ ETH — quay lại bước 0a/2.
- **RPC timeout/rate limit giữa chừng**: dùng RPC free-tier công khai thay vì Alchemy/
  Infura có key riêng — đổi provider hoặc chờ vài phút rồi thử lại (không chạy lại toàn
  bộ script, xem cảnh báo ở bước 3).
- **Giao dịch pending rất lâu không confirm**: gas price network đang cao bất thường hoặc
  RPC node bị lag — kiểm tra trực tiếp trên block explorer bằng địa chỉ ví deployer xem
  giao dịch có nằm trong mempool không.
- **`AaveStrategy` deploy được nhưng gọi `deposit` sau đó lỗi**: kiểm tra lại đúng địa chỉ
  Aave Pool/aToken cho ĐÚNG network (2 testnet có địa chỉ khác nhau, không dùng nhầm địa
  chỉ Arbitrum Sepolia cho Base Sepolia hoặc ngược lại).
