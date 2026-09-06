const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Vault Security Audit: HTTP giữa client và RPC/backend lộ toàn bộ request (địa chỉ
 * ví, số dư, allocation...) cho bất kỳ ai đứng giữa (MITM) và cho phép kẻ tấn công
 * chèn/đổi response (ví dụ trả sai balance hay chặn tx). Fail-fast ngay lúc module load
 * thay vì âm thầm chạy sai, để 1 endpoint không HTTPS không bao giờ lọt ra người dùng
 * thật.
 *
 * Cố ý KHÔNG check theo `NODE_ENV === "production"`: `next build` luôn set NODE_ENV=
 * production kể cả khi build nhắm vào Hardhat local (deployments.local.json trỏ
 * `http://127.0.0.1:8545`) - dùng NODE_ENV làm điều kiện sẽ làm hỏng chính build local/CI
 * hiện tại của dự án, vốn chưa deploy lên network thật nào. Rủi ro MITM chỉ tồn tại khi
 * traffic thực sự rời khỏi máy (loopback) - nên check đúng bản chất đó: cho phép http://
 * với localhost/127.0.0.1/::1 ở BẤT KỲ môi trường nào, bắt buộc https:// cho mọi host
 * khác (kể cả lúc dev trỏ nhầm vào 1 RPC/backend thật không có TLS).
 */
export function assertHttpsInProduction(label: string, url: string): void {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(`${label} is not a valid URL: "${url}"`);
  }

  if (LOOPBACK_HOSTNAMES.has(hostname)) return;

  if (!url.startsWith("https://")) {
    throw new Error(
      `${label} must use https:// for any non-localhost endpoint (got "${url}"). Refusing to talk to an insecure remote endpoint.`,
    );
  }
}
