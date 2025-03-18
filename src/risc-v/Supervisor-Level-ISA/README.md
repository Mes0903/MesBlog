---
title: (WIP) Supervisor-Level ISA
date: 2025-02-25
tag: risc-v
category: risc-v
---

# 12. Supervisor-Level ISA, Version 1.13

### 12.1.1. Supervisor Status (`sstatus`) Register

`sstatus` 暫存器是一個 SXLEN-bit read/write 的暫存器，用來追蹤處理器目前的狀態，為 `mstatus` 的子集

當 `SXLEN` 為 32 時，格式如下圖：

<center>

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/risc-v/Supervisor-Level-ISA/image/sstatus1.png?raw=true">

</center><br>

當 `SXLEN` 為 64 時格式如下圖：

<center>

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/risc-v/Supervisor-Level-ISA/image/sstatus2.png?raw=true">

</center><br>

- `SPP` 
  - `SPP` 位元表示 hart 在進入 S-mode 之前執行的特權等級
  - 當 Trap 發生時，如果其源自 U-mode，則 `SPP` 設定為 0，否則為 1
  - 當執行 `SRET` 指令從 trap handler 返回時
    - 如果 `SPP` 為 0，則特權等級會被設為 U-mode
    - 否則設為 S-mode 並將 `SPP` 設為 0
- `SIE`
  - 用來啟用或禁用 S-mode 下的所有中斷
    - 清 0 時 S-mode 下不會產生中斷
  - 如果 hart 運行在 U-mode，`SIE` 的值會被忽略，且會啟用 S-mode 的中斷
  - supervisor 可以利用 `sie` CSR 來停用單一的中斷來源
- `SPIE`
  - 用來紀錄在進入 S-mode 之前是否啟用了 S-mode 下的中斷
  - 當 Trap 進入 S-mode 時，`SPIE` 被設為 `SIE`，並且 `SIE` 被設為 0
  - 執行 `SRET` 指令時，`SIE` 被設為 `SPIE`，然後 `SPIE` 被設為 1

:::info  
在較簡單的實作中，讀取或寫入 `sstatus` 中的任何字段相當於讀取或寫入 `mstatus` 中的同名字段  
:::

#### 12.1.1.1. Base ISA Control in `sstatus` Register

`UXL` 欄位控制 U-mode 的 `XLEN` 值，稱為 `UXLEN`，其可能與 S-mode 的 `XLEN` 值不同(稱為 `SXLEN`)。 簡單來說：

- `UXLEN` 表示 U-mode 的位元寬度，決定 U-mode 下的有效位址長度
- `SXLEN` 表示 S-mode 或 M-mode 下的位元寬度，決定系統支援的完整位址空間

`UXL` 的編碼與 `misa` 內的 `MXL` 相同，`MXL` 的編碼如下表：

<center>

| MXL | XLEN | 
| - | - |
| 1 | 32 |
| 2 | 64 |
| 3 | 128 |

</center>

當 `SXLEN` 為 32 時，`UXL` 欄位不存在，此時 `UXLEN` 為 32。 當 `SXLEN` 為 64 時，它是一個 WARL 字段，值為當前 `UXLEN` 值的編碼。 具體來說，UXL 可能被實作為一個唯讀的字段，其值始終保證 `UXLEN = SXLEN`

如果 `UXLEN ≠ SXLEN`，則在 narrower mode 下執行的指令必須忽略配置的 `XLEN` 以上的來源暫存器運算元，並且必須對結果進行 sign-extend 以填充目標暫存器中最寬的 `XLEN`

如果 `UXLEN < SXLEN`，U-mode 下的 instruction-fetch 位址，和 load/store 的有效位址以 $2^{\text{UXLEN}}$ 模除。 換句話說，因為此時 U-mode 的指令和記憶體存取位址的有效位元數比 S-mode 的位址還短，因此只能存取較低範圍的記憶體

舉個例子，當 `UXLEN` 為 32，`SXLEN` 為 64 的情況下，U-mode 下的程式無論怎麼操作記憶體，都只能看到低 4GiB 的記憶體範圍，換句話說 U-mode 的記憶體存取是 32 位元地址空間內的操作，而不是完整的 64 位元地址空間

> $2^{32}$ = 4GiB

##### HINT 相關

HINT 指令是沒有實際運算效果，但可能被用來提供某些優化或調整的指令。 某些 HINT 指令會被編碼為整數計算指令，其會利用當下的值覆蓋目標暫存器值

此時若 `XLEN < SXLEN` 且目標暫存器 `SXLEN .. XLEN` 處的位元與 `XLEN - 1` 處的不一致，則目標暫存器 `SXLEN .. XLEN` 處的位元會依照 implementation-defined 的方式，將其值保留或以 `XLEN - 1` 處的位元延展覆蓋

舉個例子，例如 `c.addi x8, 0` 這個指令，其等同於 `addi x8 x8 0`，也就是 `x8 = x8`，這是一個 HINT 指令，對計算沒有影響。 假設 U-mode 運行在 `XLEN = 32`，但暫存器是 64 位元的(`SXLEN = 64`)，而假設目標暫存器 `x8` 的內容如下：

```assembly
64-bit register (SXLEN=64, XLEN=32)
┌──────────────────────────┬────────────────────────┐
│ 高 32 位元 (SXLEN..XLEN) │ 低 32 位元 (XLEN)      │
│  0xF0000000              │  0x12345678            │
└──────────────────────────┴────────────────────────┘
```

其中低 32 位元(`0x12345678`) 是有效值，而高 32 位元(`0xF0000000`) 是超出 `XLEN` 的部分，內容可能來自之前的運算

當執行 HINT 指令 `c.addi x8, 0` 時  
- 低 32 位元(`XLEN`) 會保持不變(`0x12345678`)
- 高 32 位元 (`SXLEN..XLEN`) 有兩種可能的行為：
    - 不變，保持 `0xF0000000`  
    - 以 `XLEN-1` 位元的值延展覆蓋為 `0x00000000`

這允許實作上省略 HINT 指令中目標暫存器的寫回(writeback)，其也可以選擇將部分 HINT 指令像一般整數運算指令一樣執行。 這種選擇只會影響到 S-mode 下 `SXLEN > UXLEN` 的情況，對 U-mode 來說這個行為完全不可見

一般的整數運算指令(如 `addi x8, 0`) 都會：
- 讀取 `x8` 的值
- 執行計算(這裡是 `+0`，所以結果不變)
- 寫回 `x8`

但對於 HINT 指令，CPU 可以選擇「完全不寫回 `x8`」，因為它不影響計算結果

#### 12.1.1.2. Memory Privilege in `sstatus` Register (`MXR` 與 `SUM`)

`MXR`(Make eXecutable Readable) 位元控制讀取(load) 虛擬記憶體的權限

- `MXR = 0`
  - 只允許讀取標記為可讀(`R=1`)的 page
- `MXR = 1`
  - 允許讀取可讀(`R=1`) 或可執行(`X=1`) 的 page

當 page-based 的虛擬記憶體未啟用時(`satp.MODE = Bare`)，`MXR` 沒有作用

`SUM`(permit Supervisor User Memory access) 位元控制 S-mode 下存取 U-mode page 的權限

- `SUM = 0`
  - S-mode 無法存取 「U-mode 可存取(`U=1`)」的 page
  - 如果嘗試存取，會產生錯誤(fault)
- `SUM = 1`
  - 允許 S-mode 存取 `U=1` 的 page

當 paged-based 的虛擬記憶體未啟用，或者運行在 U-mode 時，`SUM` 沒有作用。 另外無論 `SUM` 的狀態為何，S-mode 下都無法執行 U-mode page 中的指令

如果 `satp.MODE` 是唯讀的 0 (`satp.MODE=0`)，則 `SUM` 也是唯讀的 0，這表示在不支援 page 的系統上，S-mode 永遠無法存取 U-mode 記憶體

page table entry 可以參考下圖(Sv32 page table entry)

<center>

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/risc-v/Supervisor-Level-ISA/image/sv32_page_table_entry.png?raw=true">

</center><br>

`SUM` 的機制可以防止 S-mode 下的軟體意外存取 user memory，作業系統可以在 `SUM=0` 的情況下執行大部分的程式碼，並在少數需要訪問 user memory 的情況下再暫時設定 `SUM`

`SUM` 的機制不允許 S-mode 軟體執行 user code pages 中的指令。 但這在其他場景下通常也是個不合法的操作，在 POSIX 環境中也禁止 S-mode 執行 U-mode memory page 中的指令，因為如果 S-mode 中存在任意代碼執行(Arbitrary Code Execution, ACE) 的漏洞，那麼這類漏洞將變得更容易被利用，特別是當攻擊者能夠將惡意代碼存放在 U-mode 可存取的記憶體 (user buffer) 並在攻擊過程中執行它

但是有些 non-POSIX 的單一位址空間(Single Address Space) 作業系統允許部分軟體在 S-mode 下執行 U-mode program，其大部分程式都運行在 U-mode 下，並和 kernel 共用同一個位址空間。 在這種情況下，可以通過映射相同的物理記憶體到不同的虛擬記憶體頁面，並設定不同的權限來允許 S-mode 軟體部分執行 U-mode 的程式碼

#### 12.1.1.3. Endianness Control in `sstatus` Register (`UBE`)

`UBE` 為原是個 WARL 的字段，用來控制 U-mode 下記憶體存取的位元組順序(Endianness)，其可能與 S-mode 下的位元組順序不同。 實作上可能會把 UBE 設成一個唯讀的字段，使其始終與 S-mode 的位元組順序相同

- `UBE = 0`：使用小端序(little-endian)
- `UBE = 1`：使用大端序(big-endian)

另外

- instruction-fetch 不受 `UBE` 的影響
  - 其屬於隱式(implicit) 記憶體存取，永遠是小端序(little-endian)
- `UBE` 不影響 S-mode 相關的隱式記憶體存取
  - 如 S-mode 讀取 page table 或其他記憶體管理資料結構，這些記憶體存取總是使用 S-mode 的位元組順序

標準的 RISC-V ABI 只能是純小端 (Little-Endian, LE) 或純大端 (Big-Endian, BE)，不允許混合大小端(mixing endianness)。 儘管標準 ABI 只能是純 LE 或純 BE，但 RISC-V 還是允許作業系統支援與自身大小端不同的 U-mode 應用程式

#### 12.1.1.4. Previous Expected Landing Pad (ELP) State in `sstatus` Register

`SPELP` 欄位由 Zicflip 擴充指令集引入，用途與控制流完整性(CFI) 有關。 在 S-mode 下存取 `SPELP` 欄位時，會根據 `V` 位元的狀態來決定要存取 `mstatus.SPELP` 還是 `vsstatus.SPELP`：

- `V=0`(非虛擬化模式)：存取 `mstatus.SPELP`
- `V=1`(虛擬化模式)：存取 `vsttatus.SPELP`

#### 12.1.1.5. Double Trap Control in `sstatus` Register

`SDT`(S-mode-disable-trap) 是一個 WARL 的欄位，由 Ssdbltrp 擴充指令集引入，用來解決 S-mode 以下 double trap 的問題

> double trap 指的是，當 Trap handler 正在處理異常(Trap) 且正處於 non-reentrant 的狀態時，發生了另一個異常，導致其無法正常處理

當 `SDT` 位元透過 CSR write 顯式設為 1 時，無論該操作是否在同一寫入中試圖設定 `SIE`，`SIE` 都會被強制清 0，這代表 S-mode 將無法接受中斷。 而執行 `SRET` 指令 `SDT` 會被清 0

`SIE=1` 只能發生在 `SDT=0` 的情況下，如果 `SDT=1`，則 `SIE` 無法手動設為 `1`，這確保在 `SDT=1` 時 S-mode 不會收到新的中斷

當系統發生異常(Trap) 時，如果 `SDT=0`，則 `SDT` 會被自動設定為 `1`，之後異常會正常傳遞到 S-mode。 然而如果 `SDT` 已經是 `1`(代表 S-mode 已經在處理異常)，則這是一個意外異常(unexpected trap)，當意外異常發生時，其會產生「Double-Trap Exception」，以將意外異常傳遞給 M-mode 處理

之後會由 M-mode 接管處理該異常，期間 hart 會將該異常的資訊寫入對應的暫存器，但 `mcause` 和 `mtval2` 例外，`mtval2` 會存入「原本應該寫入 `mcause` 的值」，`mcause` 會被設為 `16`，代表這是一個 double-trap exception，好讓 M-mode 可以識別這是一個 S-mode 無法處理的異常

Trap handler 需要在儲存好 `scause`、`sepc`、`stval` 等狀態，並且可重入(reentrant) 後清除 `SDT` 位元，這表示在 Trap handler 的尾聲，如果在恢復系統狀態時又發生了新的異常，`SDT` 可以幫助 M-mode 檢測到這種情況

如果 guest OS 發生 page-fault，而這個異常觸發了 double trap，那麼當其被遞交到 M-mode 時，`mtval2` 暫存器將不會包含 Guest Physical Address (GPA)，這代表 Hypervisor 無法直接從 `mtval2` 取得 guest 的物理地址。 這會發生在 HS-mode 下執行虛擬機內的存取指令(load 或 store)，且

- `SDT=1`
- 該存取指令導致了 guest page-fault

時，不過這不常發生。 另外，儘管 GPA 不會被記錄，但這沒關係，需要的話仍可以通過遍歷 page table 來達成目的

對於源自 VS-mode 的 double trap，M-mode 應該要將該異常重新導向到 HS-mode，具體做法是：

- 將 M-mode 處理該異常時更新的 CSR 的值複製到 HS-mode 中對應的 CSR
- 使用 `MRET` 指令恢復執行，並從 `stvec` 指定的位址繼續執行

SSE (Supervisor Software Events) 是 SBI (Supervisor Binary Interface) 的一項擴充，提供一種機制，使監督者軟體 (Supervisor Software) 能夠註冊 (register) 並處理 (service) 來自 SBI 實作的系統事件。 這些事件可能來自 SBI 內部，例如韌體或 Hypervisor

當發生 double trap 時，HS-mode 和 M-mode 可以使用 SSE 機制來啟動 critical-error handler 以處理對應的 VS-mode 或 S/HS-mode 中發生的異常。 此外，實作 SSE protocol 也可以做為一個選項，幫助系統從這類 critical errors 中恢復

### 12.1.2. Supervisor Trap Vector Base Address (`stvec`) Register

`stvec` 是一個 SXLEN-bit 的可讀寫暫存器，用來存 trap vector 的設定，包含：

- vector base address (`BASE`)
- vetor mode (`MODE`)

決定進入 S-mode 下的異常 (Exception) 和中斷 (Interrupt) 後 PC 該跳轉到哪裡，配置方式如下圖：

<center>

![alt text](image/stvec.png)

</center>

`BASE` 欄位可以存放任何有效的虛擬位址或實體位址，但需符合以下對齊限制：
- 該位址必須以 4-byte 對齊 (最低兩個位元為 0)
- 若 `MODE` 不是 **Direct**，可能還會有更嚴格的對齊限制作用在 `BASE` 的值上
    - 在 **VECTORED** 模式下，因為 trap vector 會根據中斷號 (cause) 來做位址計算 (例如 `BASE + 4×cause`)，因此地址可能要符合更高的要求

下表為 `stvec.MODE` 的編碼方式：

| Value | Name     | Description                                     |
| ----- | -------- | ----------------------------------------------- |
| 0     | Direct   | All exceptions set pc to BASE.                  |
| 1     | Vectored | Asynchronous interrupts set pc to BASE+4×cause. |
| ≥2    |          | Reserved                                        |

當 `MODE=Direct` 時，所有 traps 進入 S-mode 都會將 pc 設為 `BASE` 欄位中的位址

而當 `MODE=Vectored` 時，所有同步異常 (synchronous exceptions) 在進入 S-mode 後，pc 依舊會設為 BASE； 但如果是中斷 ，則 pc 會設為 `BASE + 4×cause`

例如 Supervisor-mode 計時器中斷在 RISC-V 中通常是 cause = 5 (參考具體標準)，所以 `pc = BASE + (4×5) = BASE + 0x14`

為了讓 `pc = BASE + 4×cause` 不越界或錯亂，一般會要求 `BASE` 有更高的對齊要求，比如 16-byte 或 128-byte 對齊，具體要看實作和規範版本

### 12.1.3. Supervisor Interrupt (`sip` and `sie`) Registers

`sip` 暫存器是一個 SXLEN-bit 的可讀寫寄存器，其內容代表當前等待處理 (pending) 的中斷資訊

`sie` 暫存器則是對應的 SXLEN 位元可讀寫寄存器，其中紀錄啟用中斷的位元

在 `scause` CSR 裏面所報告的中斷原因編號 `i`（參考第 12.1.8 節）對應到 `sip` 與 `sie` 的第 i 個位元

位元 0~15 (bits 15:0) 保留給標準中斷原因（例如軟體中斷、計時器中斷等），16 以上的位元則留給平台自行使用

<center>

![alt text](image/sipsie.png)

</center>

一個編號為 `i` 的中斷，只有在以下兩個條件都成立時，才會陷入到 S-mode 進行處理：

- (a)
    - 當前特權模式是 S-mode，並且 `sstatus` 寄存器裡的 `SIE` 位元為 1
    - 或是當前特權模式低於 S-mode（也就是 U-mode 等更低特權模式）
- (b) 
    - `sip[i]` 與 `sie[i]` 都為 1，也就是該中斷 `i` 正在等待處理 並且已被啟用

硬體 (或實作) 在偵測到 `sip[i]` 發生變化（例如 `0→1`）時，應該在 合理且有限的時間內檢查是否要觸發中斷，不能無限制地拖延，否則中斷就失去意義

同時，也必須在執行 `SRET` 指令之後，以及對任何會影響中斷陷阱條件的 CSR（例如 `sip`, `sie`, `sstatus`）進行「顯式寫入 (explicit write)」後，立即重新評估這些條件

對 S-mode 的中斷優先於對任何更低特權模式（例如 U-mode）的中斷

在 `sip` 寄存器中，每個位元都可能是可寫，也可能是唯讀的，當第 `i` 位元是可寫的時，如果中斷 `i` 處於 pending 狀態，可以透過寫入 0 到此位元的方式來清除該中斷

如果一個中斷 `i` 可能處於等待狀態，但是 `sip` 中該位元是唯讀的，那麼必須由實作提供其他機制來清除該 pending 中斷（可能需要透過呼叫執行環境 (execution environment) 的某種方法）

在 `sie` 寄存器中，如果對應的中斷可能變成 pending 的，那麼該位元就必須是可寫的。 若某些位元是不可寫的，那它們就會是唯讀的，且永遠為 0（該中斷永遠不會發生）

`sip` 與 `sie` 的 標準部分(bits 15:0)，格式如下圖所示：

<center>

![alt text](image/sipsie2.png)

</center>

`sip.SEIP` 與 `sie.SEIE` 對應到 S-mode 外部中斷 (supervisor-level external interrupts) 的「等待 (pending)」與「啟用 (enable)」位。 若實作了此功能，則 `sip` 中的 `SEIP` 是唯讀的，它的設置和清除由執行環境（通常透過平台特定的中斷控制器）來完成

`sip.STIP` 與 `sie.STIE` 對應到 S-mode 計時器中斷 (timer interrupt) 的「等待」與「啟用」位。 若實作了此功能，則 `sip` 中的 `STIP` 是 唯讀，由執行環境來設置或清除

`sip.SSIP` 與 `sie.SSIE` 對應到 S-mode 軟體中斷 (software interrupt) 的「等待」與「啟用」位。 若系統實作該功能，`sip` 中的 `SSIP` 是 可寫的，也可能由平台特定的中斷控制器設置為 1

> 外部中斷往往是由硬體控制器 (PIC, PLIC, etc.) 來管理，S-mode 只能透過平台特定的方法去清除 pending。 計時器中斷通常也是由硬體或韌體自動管理，軟體無法直接清除 pending，故 STIP 是唯讀

若系統實作了 Sscofpmf 擴充，則 `sip.LCOFIP` 與 `sie.LCOFIE` 這些位元對應到 local counter-overflow interrupt 的等待與啟用。 `sip.LCOFIP` 在 `sip` 中是可讀寫 (read-write)，當 `mhpmeventn.OF` 中任何一個位元被設置（表示計數器溢出）時，就會反映成一個 local counter-overflow interrupt。 如果 Sscofpmf 未實作，那麼 `sip.LCOFIP` 與 `sie.LCOFIE` 是唯讀的且永遠為 0

> Sscofpmf (Supervisor Software Counter Overflow Performance Monitoring)：一種專門的擴充，用於監測計數器溢出事件

:::info  
跨處理器中斷 (Interprocessor interrupts) 是透過特定的實作方式發送到其他 hart，最終會使接收端 hart 的 `sip` 寄存器中的 `SSIP` 位元被設為 1  
:::

每一種標準中斷類型（`SEI`、`STI`、`SSI`、或 `LCOFI`）都可能不被實作；如果沒有實作，對應的等待與啟用位就會是唯讀且為 0 的

`sip` 與 `sie` 中的所有位元都是 WARL 欄位，可透過在 `sie` 寄存器的每個位元都寫入 1，然後再讀回來檢查哪個位元真的保持在 1，就能得知系統實際實作了哪些中斷

:::info  
`sip` 與 `sie` 是 `mip` 與 `mie` 的子集，讀取或寫入 `sip/sie` 的任何已實作欄位，同時也會對應到 `mip/mie` 裡的相同欄位，也就是說當你寫 `sip.SSIP=1`，實際硬體也會把 `mip.SSIP` 做相應設定

在 `sip` 與 `sie` 中的第 3、7 和 11 個 bit，分別對應 M-mode 的軟體、計時器與外部中斷。 由於大多數平台都選擇不將這些中斷從 M-mode 委派(delegate) 到 S-mode，所以在圖 54 與圖 55 中，這些位元顯示為 0  
:::

當同時有多個要進入 S-mode 的中斷發生時，其處理順序（由高至低優先權）如下：  
- SEI (Supervisor External Interrupt)
- SSI (Supervisor Software Interrupt)
- STI (Supervisor Timer Interrupt)
- LCOFI (Local Counter Overflow Interrupt)

### 12.1.4. Supervisor Timers and Performance Counters

S-mode 和 U-mode 使用相同的硬體效能監控機制(hardware performance monitoring facility)，其中包含 `time`、`cycle` 和 `instret` 這些 CSR，實作應提供機制來修改這些計數器的值

另外，實作必須提供一種機制，讓系統能夠依據真實時間計數器來 schedule 計時器中斷