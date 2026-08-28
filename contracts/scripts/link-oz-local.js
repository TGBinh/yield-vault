// Trong npm workspaces, @openzeppelin/contracts bị hoist lên node_modules gốc.
// Một số công cụ (vd. VS Code Solidity extension của Juan Blanco) không tự đi
// ngược lên tìm node_modules ở workspace root, nên tạo 1 link cục bộ trong
// contracts/node_modules để đảm bảo import luôn resolve được, bất kể công cụ nào đọc.
const fs = require("fs");
const path = require("path");

const target = path.join(__dirname, "..", "..", "node_modules", "@openzeppelin");
const linkPath = path.join(__dirname, "..", "node_modules", "@openzeppelin");

if (!fs.existsSync(target)) {
  console.warn("link-oz-local: target not found", target, "- skipping.");
  process.exit(0);
}

if (fs.existsSync(linkPath)) {
  process.exit(0);
}

fs.mkdirSync(path.dirname(linkPath), { recursive: true });
fs.symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : "dir");
console.log("link-oz-local: created link", linkPath, "->", target);
