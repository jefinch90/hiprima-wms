# Hi.PRIMA WMS — CHECKPOINT

## Project Architecture
- Frontend: Next.js
- Hosting: GitHub Pages
- Backend: Supabase
- Tidak menggunakan Vercel
- Branch utama pengembangan: development

## Deployment Workflow
Setiap fitur selesai:
1. Test di localhost
2. Commit
3. Push origin development
4. Cek GitHub Actions
5. Pastikan Build = Success
6. Pastikan Deploy = Success
7. Cek GitHub Pages
8. Baru lanjut fitur berikutnya

## Responsive UI Standard
- Page tidak boleh mengalami horizontal overflow.
- Gunakan min-w-0 pada container utama.
- Gunakan overflow-x-hidden pada page.
- Horizontal scrolling hanya boleh terjadi pada container tabel menggunakan overflow-x-auto.
- Tombol fixed menggunakan shrink-0 bila diperlukan.

## COMPLETED FEATURES

### Inventory Core
- Inventory
- Stock Movement
- Adjustment
- Transfer
- Return
- Stock Opname / Cycle Count
- Full Opname
- Location
- Stock Areas
- Role / access control
- RLS / security controls

### Master Products
- Product master
- Product variants / SKU
- Variant stock
- Normal / Defect / Reject stock
- Location per variant
- Product search
- Product detail

### HPP & Harga Jual
Database:
- product_variants.hpp = numeric
- product_variants.selling_price = numeric
- product_variants.cost_price tetap ada sebagai kolom lama dan tidak diubah.

Standar:
- Database tetap numeric.
- UI menggunakan format Rupiah Indonesia.
- Contoh UI: Rp 135.000
- Export tetap numeric agar dapat dijumlahkan dan dihitung.

RPC:
- get_product_variants sudah mengembalikan:
  - hpp
  - selling_price
  - normal_qty
  - defect_qty
  - reject_qty
  - total_qty
  - locations

Source pricing:
- CSV berisi 3.750 SKU.
- 3.743 SKU ditemukan di WMS.
- 7 SKU tidak ditemukan dan tidak dibuat otomatis.

Products UI:
- HPP tampil dalam format Rupiah.
- Harga Jual tampil dalam format Rupiah.
- Data asli tetap numeric.

## LAST CHECKPOINT

Commit:
Add HPP and selling price to products

GitHub Actions:
- Build: SUCCESS
- Deploy: SUCCESS

GitHub Pages:
- Sudah berhasil live / published.

## NEXT FEATURE — #16

Inventory Valuation + Gross Profit + Margin

Rumus:
- Gross Profit/unit = Harga Jual - HPP
- Margin % = (Harga Jual - HPP) / Harga Jual × 100
- Nilai Stok HPP = Qty × HPP
- Potential Sales Value = Qty NORMAL × Harga Jual
- Potential Gross Profit = Qty NORMAL × (Harga Jual - HPP)

Untuk potential sales dan potential gross profit:
- Hanya stok NORMAL yang dihitung.
- Defect dan Reject tidak dihitung sebagai stok siap jual.

Target UI:
Products detail:
SKU | HPP | Harga Jual | Gross Profit | Margin | Normal | Defect | Reject | Total

Inventory:
- Inventory Value (HPP)
- Potential Sales Value
- Potential Gross Profit
- Margin

Format:
- Rupiah hanya untuk tampilan.
- Persentase hanya untuk tampilan.
- Database dan export tetap numeric.

## WORKING RULES

- Jangan mengulang fitur yang sudah selesai.
- Jangan mengulang pengecekan yang sudah terbukti berhasil.
- Sebelum coding, cek struktur file/RPC yang benar-benar sedang digunakan.
- Jangan menebak nama tabel, kolom, atau RPC.
- Gunakan full-file replacement bila memungkinkan agar mudah copy-paste.
- Jangan mengubah fungsi stock/opname yang sudah berjalan tanpa alasan.
- Setelah fitur baru selesai, test lokal terlebih dahulu.
- Jangan commit/push sebelum fitur dinyatakan OK.
- Setelah user menyatakan OK:
  Commit → Push origin development → GitHub Actions → Build → Deploy → GitHub Pages.

## CURRENT STOP POINT

Fitur terakhir yang sudah live:
HPP + Harga Jual pada Products.

Fitur berikutnya:
#16 Inventory Valuation + Gross Profit + Margin.

Lanjutkan dari titik ini tanpa mengulang proses sebelumnya.
