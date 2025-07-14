---
title: （WIP）RISC-V Machine-Level ISA
date: 2025-06-19
tag: risc-v
category: risc-v
---

# 3. Machine-Level ISA, Version 1.13

本篇為 RISC-V Machine-Level ISA（Version 20241101）的中文翻譯與筆記，原文可於[官方 github](https://github.com/riscv/riscv-isa-manual/tree/main) 的第 3 章中看到。 大部分的情況下我會直接直譯，但有些地方我覺得文件實在寫得很繞，那種地方我就會直接用我自己的話寫了，或是多補一個 Tips Block 做解釋

本篇內的 Info block 為原文中的補充段落，我全部都有翻，但會依照前後文的語境來決定要不要安插 Info block 進來，也就是說雖然本文中有些段落不在藍色的 Info 區塊內，但在原文中其屬於補充段落。 至於綠色的 Tips block 則是我個人的補充筆記

## 3.1. Machine-Level CSRs

除了本節所描述的 machine-level 的 CSR 外，M-mode 的程式碼也可以存取所有較低權限等級的 CSR

### 3.1.1. Machine ISA (`misa`) Register

`misa` 這個 CSR 是一個 WARL 類型的可讀寫暫存器，用來回報該 hart 所支援的 ISA。 每個實作都要確保這個暫存器可以被讀取。 如果其回傳 0，代表 `misa` 暫存器未被實作，這種情況下需要透過額外的非標準機制來判斷 CPU 的能力。 misa CSR 的寬度為 MXLEN 位元（見下一段）

![（Figure 2. Machine ISA register (misa)）](image/misa.png)

MXL（Machine XLEN）欄位會編碼這顆 hart 所使用的整數基礎 ISA 的寬度，如表 9 所示。 MXL 是唯讀欄位。 若 `misa` 的值不為 0，則 MXL 欄位代表 M-mode 下的有效 XLEN，這個值會被稱為 MXLEN。 XLEN 永遠不會大於 MXLEN，但在較低權限的模式中，XLEN 可能小於 MXLEN

<span class = "center-column">

| MXL | XLEN |
| - | - |
| 1 | 32 |
| 2 | 64 |
| 3 | Reserved |

（Table 9. Encoding of MXL field in `misa`）

</span>

::: tip  
如同 S-mode ISA 裡面提到的，XLEN 是 CPU 處理整數時的位元寬度，可能是 32、64 或 128。 而 MXL 會告訴你 M-mode 底下的實際位寬是什麼，這對後續要解碼其他 CSR 或資料有幫助  
:::

::: info  
我們可以透過檢查讀取到的 `misa` 值的正負號，或是透過將該值左移一位並再檢查一次正負號，來判斷基礎位寬。 這些檢查可以用組合語言寫，不需要事先知道該 hart 的 register 寬度（MXLEN）。 基礎位寬的公式是 $MXLEN = 2^{MXL + 4}$  

如果 `misa` 為 0，也可以用另一種方法來推得基礎位寬：將立即數 2 放入一個暫存器，然後將其左移 31 位元。 若結果為 0，則該 hart 是 RV32；否則就是 RV64  
:::

Extensions 欄位用來代表標準 extension 是否存在，每個英文字母對應一個 bit（bit 0 表示 extension "A" 是否存在，bit 1 表示 "B"，一直到 bit 25 表示 "Z"）。 例如，RV32I 或 RV64I 的 base ISA，"I" 這個 bit 會被設成 1； 而 RV32E 或 RV64E，則 "E" 會被設成 1。 Extensions 欄位是 WARL 類型的欄位，如果實作上允許修改所支援的 ISA，這些 bit 就可以被寫入。 在 reset 時，Extensions 欄位應該要包含該 hart 所支援的最大 extension 集合，且當 "I" 與 "E" 同時可用時，應該選擇 "I"

當在 `misa` 中把某個標準 extension 對應的 bit 清除（設為 0）時，該 extension 所定義或修改的指令與 CSR 會回復為其預設或保留的行為，就好像該 extension 根本沒有被實作一樣

::: info  
對於一個給定的 RISC-V 執行環境，是否實作某個指令、extension，或其他 RISC-V ISA 的特性，通常是根據該環境中可觀察到的執行行為來判斷。 例如，只有當 RISC-V Unprivileged ISA 中為 F extension 所定義的指令能如規範所述執行時，F extension 才能算是有在該執行環境中被實作

根據上述對「實作」的定義，若在 `misa` 中清除某個 extension 對應的 bit，該 extension 在 M-mode 中就會被視為「未實作」。 例如，把 `misa.F` 設成 0，就代表在 M-mode 中 F extension 沒有被實作，因為 F extension 的指令將不會依照 Unprivileged ISA 的要求執行，反而可能會觸發 illegal-instruction exception

將「實作」這個詞定義為完全根據可觀察的執行行為，可能會與一般常見的用法產生衝突。 特別是，一般說法可能會接受「實作了但停用」這種說法，但在本文件中，這被視為詞義上的矛盾，因為「停用」代表該功能的執行行為不會如其規範所要求，因此不能算是「實作」。 同樣地，「已實作且啟用」在這裡也是多餘的說法，用「實作」就已經包含其啟用的意思  
:::

::: tip  
在這份文件中，「implemented（實作）」這個詞是非常嚴格的，只要功能沒有依照規範執行，就不算實作。 所以你不能說「我有實作但現在把它關掉了」，在這邊這會被視為語意上的矛盾

而 `misa` 只是表達你「打算」支援哪些 extension，一旦你把某個 bit 清掉（即使電路還在），它的指令行為就不是照規範走，因此就不算有「實作」該 extension。 比如把 `misa.F` 清掉後，即使硬體能跑浮點指令，CPU 也會當作這些指令是非法的，這就是「未實作」。 這讓 `misa` 不只是資訊回報用途，也可以讓實作端支援切換功能  
:::

<span class = "center-column">

| Bit | Character | Description                                                |
| --: | :-------: | ---------------------------------------------------------- |
|   0 |     A     | Atomic extension                                           |
|   1 |     B     | B extension                                                |
|   2 |     C     | Compressed extension                                       |
|   3 |     D     | Double-precision floating-point extension                  |
|   4 |     E     | RV32E/64E base ISA                                         |
|   5 |     F     | Single-precision floating-point extension                  |
|   6 |     G     | *Reserved*                                                 |
|   7 |     H     | Hypervisor extension                                       |
|   8 |     I     | RV32I/64I base ISA                                         |
|   9 |     J     | *Reserved*                                                 |
|  10 |     K     | *Reserved*                                                 |
|  11 |     L     | *Reserved*                                                 |
|  12 |     M     | Integer Multiply/Divide extension                          |
|  13 |     N     | *Tentatively reserved for User-Level Interrupts extension* |
|  14 |     O     | *Reserved*                                                 |
|  15 |     P     | *Tentatively reserved for Packed-SIMD extension*           |
|  16 |     Q     | Quad-precision floating-point extension                    |
|  17 |     R     | *Reserved*                                                 |
|  18 |     S     | Supervisor mode implemented                                |
|  19 |     T     | *Reserved*                                                 |
|  20 |     U     | User mode implemented                                      |
|  21 |     V     | Vector extension                                           |
|  22 |     W     | *Reserved*                                                 |
|  23 |     X     | Non-standard extensions present                            |
|  24 |     Y     | *Reserved*                                                 |
|  25 |     Z     | *Reserved*                                                 |

（Table 10. Encoding of Extensions field in `misa`. All bits that are reserved for future use must return zero when read.）

</span>

- 若「X」這個 bit 為 1，表示有非標準的 extension 被實作，像是廠商自訂的功能之類的
- 若「B」這個 bit 為 1，表示該實作支援 Zba、Zbb 和 Zbs 這些 extension 所定義的指令。 若「B」是 0，則表示該實作可能不支援其中一個或多個 Zba、Zbb、Zbs extension
- 若「M」這個 bit 是 1，表示該實作支援 M extension 中所有乘法與除法指令。 若「M」是 0，則表示該實作可能不支援這些指令。 不過如果有支援 Zmmul extension，那麼該 extension 所定義的乘法指令仍然會被支援，不管「M」這個 bit 是多少
- 若「S」這個 bit 是 1，表示該實作支援 supervisor mode。 若「S」是 0，則表示該實作可能不支援 supervisor mode
- 若「U」這個 bit 是 1，表示該實作支援 user mode。 若「U」是 0，則表示該實作可能不支援 user mode

::: info  
`misa` 這個 CSR 向 machine-mode 程式碼提供一個簡單的 CPU 功能目錄。 若要取得更詳細的資訊，可以在 machine mode 中去探查其他 machine 級的暫存器，並在開機過程中檢查系統中其他 ROM 區域的內容

我們要求較低權限等級的程式不要直接讀取 CPU 暫存器來判斷可用的功能，而是應透過 environment call 來取得資訊。 這樣可以讓虛擬化層能夠改變各層級所觀察到的 ISA，並支援更豐富的指令介面，同時不會增加硬體設計的負擔  
:::

::: tip
「environment call」指的是 `ecall` 指令，例如 user-mode 要詢問「這個 CPU 有沒有支援浮點運算」，不能直接讀 `misa`，而應該下 `ecall` 給 OS。 這樣虛擬機器（hypervisor）或 OS 可以偽裝或限制 guest OS / user 看到的 CPU 能力（例如安全考量）

若允許低權限程式直接讀 CSR，就很難在虛擬化環境中實現資源隔離或靈活管理，這個設計讓 hardware 不需要在各層提供多份資訊，而由 software/OS 控制資訊揭露方式，讓系統更有彈性  
:::

「E」這個 bit 是唯讀的。 除非整個 `misa` 都是唯讀且為 0，否則「E」的讀取值永遠會是「I」bit 的補數。 若某個執行環境同時支援 RV32E 和 RV32I，軟體可以透過清除「I」bit 來選擇使用 RV32E

若某個 ISA 功能 `x` 依賴於另一個功能 y，當你嘗試啟用 `x` 而關閉 `y` 時，這兩個功能都會被關閉。 例如，若將「F」設為 0 而「D」設為 1，則「F」與「D」都會被清除。 同樣地，若將「U」設為 0 而「S」設為 1，則「U」與「S」也會一併被清除

某些實作可能會對多個 `misa` 欄位的組合設定施加額外限制，在這種情況下，這些欄位會被當作一個整體的 WARL 欄位來處理。 若你嘗試寫入一組不被支援的組合，這些欄位會被改寫成某個支援的組合

寫入 `misa` 有可能會增加 IALIGN，例如當你關閉「C」這個 extension 時。 如果某個指令打算寫入 `misa`，且這次寫入會使 IALIGN 增加，而下一條指令的位址又沒有對齊到新的 IALIGN 值，那這次寫入就會被取消，`misa` 保持不變

::: tip  
C extension 代表壓縮指令（16-bit），打開 C 時 IALIGN = 16，關掉 C 就要對齊到 32-bit。 如果你在某個位址寫 `misa` 並關掉 C，但下一條指令不是 32-bit 對齊的，就會有問題。 所以為了保證行為一致性，硬體會自動取消這次 `misa` 的修改  
:::

當軟體重新啟用先前被關閉的某個 extension 時，該 extension 所獨有的所有狀態都會變成未定義（`UNSPECIFIED`），除非該 extension 另有明確說明

::: info  
雖然當 `misa` 中第 0 到 25 位中的某個 bit 被設為 1 時，代表對應的功能有被實作，但反過來不一定成立，某個 bit 被清除（為 0），並不一定代表對應的功能沒有被實作。 這是因為，當某個功能沒有被實作時，對應的 opcode 和 CSR 只是變成「保留」，而不一定會是「非法」  
:::

### 3.1.2. Machine Vendor ID (`mvendorid`) Register

`mvendorid` 是一個 32 位元的唯讀 CSR，用來提供這顆核心供應商的 JEDEC 製造商代碼。 每個實作都要確保這個暫存器可以被讀取。 如果其回傳 0，表示該欄位未被實作，或是這是一個非商業用途的實作

![（Figure 3. Vendor ID register (`mvendorid`)）](image/mvendorid.png)

JEDEC 製造商 ID 通常會被編碼成一串 1-byte 的 continuation code（`0x7f`），以一個不等於 `0x7f` 的 1-byte ID 作結尾，每個 byte 的最高位會帶有奇數 parity bit。 `mvendorid` 中的 Bank 欄位會記錄 continuation code 的個數，Offset 欄位則記錄結尾的那個 byte，並捨棄 parity bit。 例如，JEDEC 的 ID 若是 `0x7f` `0x7f` ...（12 次）... `0x8a`（也就是 12 個 `0x7f` 再接一個 `0x8a`），則會被編碼成 `0x60a` 寫入 `mvendorid` CSR

::: info  
在 JEDEC 的定義中，bank 編號是「continuation code 的數量再加一」； 因此，`mvendorid` 中的 Bank 欄位所記錄的值，會比 JEDEC 的 bank 編號少 1

早期原本打算由 RISC-V International 分配 vendor ID，但這樣的做法會與 JEDEC 維護製造商 ID 標準的工作重複。 根據目前的規定，向 JEDEC 註冊一組製造商 ID 的費用為一次性 500 美元
:::

::: tip
- JEDEC 是一個標準制定組織，為記憶體、半導體等硬體產業定義了一系列標準，其中包括廠商 ID
- `mvendorid` 利用一種壓縮的方式，把 JEDEC ID 的結構用兩個欄位（Bank、Offset）表示：
  - Bank：記錄有幾個 continuation code（`0x7f`）
  - Offset：記錄最後那個非 `0x7f` 的 byte（去掉 parity）
- 上面提到的 `0x60a` 是這樣來的：
  - `Bank = 12` => `Bank field = 0xC`
  - `Offset = 0x8a & 0x7F = 0x0a`
  - `mvendorid = (0xC << 7) | 0x0a = 0x60a `

這段說明主要是幫助作業系統或其他軟體辨識 CPU 的製造商與出處，類似於 x86 中的 CPUID identifier  
:::

### 3.1.3. Machine Architecture ID (`marchid`) Register

`marchid` 是一個 MXLEN 位元寬的唯讀 CSR，用來編碼該 hart 所使用的基本微架構。 所有實作都必須確保這個暫存器能被讀取。 如果其回傳 0，表示該欄位未實作。 `mvendorid` 與 `marchid` 的組合應能唯一識別該 hart 所實作的微架構類型

![（Figure 4. Machine Architecture ID (`marchid`) register）](image/marchid.png)

開源專案的微架構 ID 是由 RISC-V International 全球分配的，其值為非零，且最高位元（MSB）為 0。 商業微架構 ID 則由各商業供應商自行分配，但其最高位元必須為 1，且其餘 MXLEN-1 個位元中不得包含 0

::: info  
微架構 ID 的設計目的是要表示開發活動所圍繞的微架構專案，而非特定的組織。 商業上針對開源設計所進行的製造，應該（並且可能在授權條款中被要求）保留原本的微架構 ID。 這有助於降低碎片化與工具支援成本，同時也能給予原始專案適當的歸屬。 開源微架構 ID 由 RISC-V International 管理，僅會分配給已經發佈且可運作的開源專案。 商業微架構 ID 則可由任何已註冊的供應商自行管理，但必須與開源 ID 保持不重複（即需設 MSB 為 1），以防供應商同時使用開源與封閉原始碼微架構時發生衝突

後面提到的 Implementation 欄位慣例可以用來區分同一微架構設計的不同分支，包括依據組織進行區分。 `misa` 暫存器也有助於辨別設計上的不同變體  
:::

### 3.1.4. Machine Implementation ID (`mimpid`) Register

`mimpid` CSR 提供一個用來編碼該處理器實作版本的唯一值。 所有實作都必須保證能讀取這個暫存器。 如果其回傳 0，表示該欄位未被實作。 Implementation 的值應該反映的是 RISC-V 處理器本身的設計版本，而不是與其周邊相關的系統

![（Figure 5. Machine Implementation ID (`mimpid`) register）](image/mimpid.png)

::: info  
這個欄位的格式由微架構原始碼提供者自行決定，但標準工具通常會將其以十六進位字串顯示，且不會有前導或尾端的 0，因此 Implementation 的值可以採用左對齊（也就是從最高有效位的 nibble 開始填入），並將各個子欄位對齊至 nibble 的邊界，以便於人閱讀  
:::

::: tip  
一個 nibble 是 4 個 bit（半個 byte）

從最高有效位的 nibble 開始填入的意思是，當你把一個 `mimpid` 的值寫進去時，是從左到右填 hex 數字，像這樣：

```
mimpid = 0x12345678
         ↑        ↑
       MS nibble   LS nibble
```

這樣稱為「從 most-significant nibble 向下填（nibble down）」。 相對的，「right-justified」就是從最小有效位（右邊）往左填  
:::

### 3.1.5. Hart ID (`mhartid`) Register

`mhartid` 是一個 MXLEN 位元寬的唯讀 CSR，裡面存放的是正在執行該程式碼的硬體執行緒（hart）的整數 ID。 所有實作都必須能讀取這個暫存器。 在多核心系統中，hart ID 不一定是連號的，但至少必須有一個 hart 的 ID 是 0。 hart ID 在整個執行環境中必須是唯一的

![（Figure 6. Hart ID (`mhartid`) register）](image/mhartid.png)

::: info  
在某些情況下，我們必須保證只有一個 hart 執行特定程式碼（例如在重置時），因此要求至少要有一個 hart 的 ID 是已知的 0。 為了效能考量，系統實作者應該盡量減少系統中所使用的最大 hart ID 數值大小  
:::

### 3.1.6. Machine Status (`mstatus` and `mstatush`) Registers

`mstatus` 是一個 MXLEN 位元寬的可讀寫暫存器，其格式在 RV32 中如圖 7 所示，在 RV64 中如圖 8 所示。 `mstatus` 用來記錄並控制該 hart 當前的作業狀態。 在 S-level ISA 中，`mstatus` 的受限版本被稱為 `sstatus` 暫存器

![（Figure 7. Machine-mode status (`mstatus`) register for RV32）](image/mstatus-32.png)

![（Figure 8. Machine-mode status (`mstatus`) register for RV64）](image/mstatus-64.png)

僅對 RV32 而言，`mstatush` 是一個 32 位元的可讀寫暫存器，其格式如圖 9 所示。 `mstatush` 的第 30 到 4 位通常對應到 RV64 中 `mstatus` 的第 62 到 36 位所包含的欄位。 欄位 SD、SXL 和 UXL 在 `mstatush` 中並不存在

![（Figure 9. Additional machine-mode status (`mstatush`) register for RV32.）](image/mstatush.png)

#### 3.1.6.1. Privilege and Global Interrupt-Enable Stack in `mstatus` register

M-mode 和 S-mode 各自提供了全域中斷啟用位元 ``MIE`` 和 `SIE`。 這些位元主要用來保證在目前的權限模式下 ISR 的原子性

::: tip
這裡的「原子性」是指在進入或退出中斷處理的過程中，不會發生中斷重入或競爭條件。 透過這些位元，可以保證一次只會處理一個中斷來源  
:::

::: info  
全域的 `xIE` 位元位於 `mstatus` 的低位，因此可以用單一的 CSR 指令來原子性地設定或清除  
:::

當某個 hart 正在以權限模式 `x` 執行時，若 `xIE`=1 則在該模式中中斷為全域啟用，反之若 `xIE`=0 則中斷為全域停用。 在此情況下權限等級低於 `x` 的模式（`w` < `x`）的中斷，總是全域停用的，不論那些模式的 `wIE` 是否設為 1。 權限等級高於 `x` 的模式（`y` > `x`）的中斷則總是全域啟用，不論高權限模式中的 `yIE` 位元如何設定。 高權限模式的程式可以透過個別中斷的啟用位元，來停用某些特定的高權限中斷，再將控制權交給較低權限模式。 若系統未實作 supervisor mode，則 `SIE` 與 `SPIE` 會是唯讀的 0

::: tip  
`xIE` 控制當前模式是否允許中斷進入（e.g. ``MIE``, `SIE`, `UIE`）  
:::

高權限模式 `y` 可以在將控制權交給低權限模式之前，關閉所有屬於它的中斷，但這種做法很少見，因為這樣會讓該 hart 只能透過同步 trap、不可屏蔽中斷（NMI），或重置，來重新奪回控制權

::: tip  
如果你完全關閉高權限模式的中斷來源（例如在 M-mode 把所有 `mie` bit 關掉），那當你跳進 S-mode 後：

- 沒有中斷能打斷 S-mode 的執行
- M-mode 將無法再重新取得控制權，除非：
  - 有 exception（trap）
  - 發生 NMI（non-maskable interrupt）
  - 系統被 reset

這種狀況通常不會是你想要的  
:::

為了支援巢狀的 trap，每個能響應中斷的權限模式 `x` 都會有一個兩層的堆疊（stack），分別用來儲存中斷啟用位元與先前的權限模式。 `xPIE` 儲存 trap 發生前 `xIE` 的值，而 `xPP` 儲存 trap 發生前的權限模式。 `xPP` 欄位只能記錄小於等於 `x` 的權限模式，因此 MPP 是 2 位元寬，而 SPP 是 1 位元寬。 當從權限模式 `y` 進入權限模式 `x` 的 trap 時，會將 `xPIE` 設為當前 `xIE` 的值，然後將 `xIE` 設為 0，`xPP` 則設為 `y`

對於低權限模式而言，無論是同步或非同步的 trap，通常都會被導向較高權限模式來處理，且在進入時會先關閉中斷。 較高權限的 trap handler 會根據儲存在堆疊中的資訊來處理並返回，或是在尚未返回中斷點前先儲存 privilege stack，然後再重新開啟中斷，這樣每個堆疊僅需儲存一筆資料即可

::: tip  
- trap handler 在進入時會先把中斷 disable（`xIE` = 0），然後處理事件
- 如果 handler 要花較久時間，或可能會被其他中斷中斷，它必須先把目前的狀態「另存」，再開中斷，才能避免破壞上一次 trap 的資訊
- 因為有 `xPIE` 和 `xPP` 作為「兩層堆疊」，每次中斷只要存一筆就夠了  
:::

用 MRET 或 SRET 指令分別用來從 M-mode 或 S-mode 的 trap 返回。 當執行 `xRET` 指令時，若 `xPP` 的值為 y，則會將 `xIE` 設為 `xPIE`，切換回權限模式 `y`，將 `xPIE` 設為 1，並把 `xPP` 設為最低支援的權限模式（若有實作 U-mode 則為 U，否則為 M）。若 `y` ≠ `M`，`xRET` 還會將 MPRV 設為 0

::: tip  
MPRV 是 memory access privilege override 位元，用來讓 M-mode 程式以較低權限模擬記憶體存取。 為了防止亂用，當你透過 sret 回到 S-mode 時，就會關掉 MPRV  
:::

::: info  
在執行 `xRET` 時將 `xPP` 設為系統支援的最低權限模式，有助於偵測軟體在管理兩層權限堆疊時的錯誤

在 trap handler 儲存處理與回復 trap 所需的關鍵狀態資訊這個階段內，不應啟用中斷或引發例外。 若在這個關鍵階段發生例外或中斷，可能會觸發新的 trap 並覆蓋掉先前的重要狀態，導致無法從原本的 trap 正確回復。 此外，若例外發生在 trap 處理流程中所依賴的路徑上，也可能導致陷入無限的 trap 迴圈。 為避免這些情況，trap handler 的設計必須極為謹慎，能夠識別並妥善處理自身流程中的例外  
:::

`xPP` 欄位是 WARL 類型，只能儲存權限模式 `x` 或比 `x` 更低的已實作模式。 若系統未實作權限模式 `x`，則 `xPP` 必須是唯讀的 0

:::info  
M-mode 的軟體可以透過將某個權限模式寫入 `MPP` 再讀回來的方式，判斷該模式是否有被實作。 若系統僅實作 U-mode 與 M-mode，那麼在硬體中只需要一個位元就能用來表示 `MPP` 是 00（U-mode）還是 11（M-mode）  
:::

#### 3.1.6.2. Double Trap Control in `mstatus` Register

double trap 通常發生在 trap 處理流程中的敏感階段，也就是當例外或中斷發生時，trap handler（負責處理這些事件的元件）處於非可重入狀態（non-reentrant）的時候。 這種非重入狀態通常出現在 trap handler 的初始階段，這時候它還沒有儲存足以處理與回復 trap 的必要狀態。 若此時再發生 trap，就可能覆寫掉關鍵狀態資訊，導致無法從原始 trap 中正確復原

這類在關鍵階段發生並導致錯誤的 trap，稱為 unexpected trap。 為了避免這種情況，trap handler 在這個階段不得啟用中斷或引發例外。 但對於硬體錯誤（Hardware-Error）例外的處理則更具挑戰性，因為這些錯誤是不可預測的，會提高發生 double trap 的風險

`MDT`（M-mode-disable-trap）位元是一個 WARL 欄位，由 Smdbltrp extension 所引入。 當系統重置時，`MDT` 的預設值為 1。 當透過明確的 CSR 寫入將 `MDT` 設為 1 時，`MIE`（Machine Interrupt Enable）位元會被清為 0。 在 RV64 中，即使同一個 CSR 寫入動作中對 `MIE` 設定了其他值，只要 `MDT` 設為 1，`MIE` 仍會被清為 0。 只有當 `MDT` 原本已經是 0，或在 RV64 中同一次寫入動作將其設為 0 時，才允許透過 CSR 寫入將 `MIE` 設為 1（在 RV32 中，`MDT` 位於 `mstatush`，而 `MIE` 位於 `mstatus`）

當系統要進入 M-mode 來處理 trap 時，如果 `MDT` 當前為 0，則會將其設為 1，並如預期一樣處理該 trap。 但如果 `MDT` 已經是 1，則該 trap 為非預期的 trap。 若系統實作了 Smrnmi extension，不論 `MDT` 是什麼狀態，RNMI（非遮蔽中斷）所引發的 trap 都不會被視為非預期 trap，且 RNMI 所引發的 trap 也不會設 `MDT` 為 1。 但如果是在 M-mode 中執行，且 `mnstatus.NMIE` 為 0 的情況下發生 trap，則此 trap 就是非預期的 trap

::: tip  
WARL（Write Any Read Legal）意味著實作可以拒絕不合法的寫入（例如你不能在 `MDT=1` 時設 `MIE=1`）。 而上方提到的機制會用來防止在 M-mode 還在處理 trap 的關鍵階段時又啟用了中斷，導致 double trap，所以：

- `MDT=1` → 自動強制關閉 `MIE`
- 你要開啟 `MIE` 前，必須先把 `MDT` 設為 0，表示已經離開非重入階段

而在處理 trap 時 `MDT` 會自動被設為 1，防止再有中斷進來，如果已經是 1，又發生了新的 trap，那代表你還沒準備好就被中斷了，所以是非預期的 trap

但 RNMI（像 NMI 一樣不能被遮蔽）例外處理不算是錯誤的 trap，因此不會更動 `MDT`，以允許在緊急情況下穿越防護機制。 而如果明明是 M-mode，但你還把 `mnstatus.NMIE` 關掉，代表你不允許 RNMI，卻又發生了 trap，那就是非法狀況了（unexpected）  
:::

當發生非預期 trap 時，其處理方式如下：

- 當實作了 Smrnmi extension 且 `mnstatus.NMIE` 為 1 時，hart 會跳入 RNMI handler。 為了送出這個 trap，系統會將原本該非預期 trap 要寫入 `mepc` 和 `mcause` 的值，改為寫入 `mnepc` 和 `mncause`。 `mnstatus` 暫存器中的權限模式欄位會被設為 M-mode，而其 `NMIE` 欄位則會被設為 0，以表示現在處於 M-mode 的 RNMI 處理流程中

  此規範的結果是：當發生 double trap 時，RNMI handler 不會取得原本應由 trap 報告的 `mtval` 與 `mtval2` 暫存器的資訊。 若需要這些資訊，RNMI handler 必須透過解碼 `mnepc` 所指向的指令，並檢查其來源暫存器的內容來取得
- 若系統未實作 Smrnmi extension，或已實作但 `mnstatus.NMIE` 為 0，則當發生非預期的 trap 時，hart 會進入 critical-error 狀態，且不會更新任何架構狀態（包含程式計數器 PC）。 此狀態下，該 hart 會停止執行，關閉所有中斷（包含 NMI），並向平台送出一個 critical-error 的訊號

  當 hart 送出 critical-error 訊號後，平台的應對行為取決於具體實作。 可能的處置包含重新啟動該 hart，或是重新啟動整個平台等

::: tip  
- Smrnmi 提供了一套機制來處理 double trap（unexpected trap），將其轉交給特殊的 RNMI handler
- `mnepc` / `mncause` 是 RNMI 專用的替代暫存器，不會覆蓋原本的 `mepc` / `mcause`
- `mnstatus.NMIE = 1` 表示允許接收 RNMI； 一旦觸發，系統會自動將其設為 0（防止再進入）
- `mnstatus` 也會註明：現在處於 M-mode 的 RNMI 處理流程中
- `mtval` / `mtval2` 通常記錄 fault 的附加資訊（像是錯誤指令位址、存取錯誤位址等）
  - 但因為 RNMI handler 不是「正規」 trap 流程，所以這兩個暫存器不會被填入資料
  - 想要知道是什麼出錯，只能自己從 `mnepc` 指向的指令反推出原因（例如是一條非法記憶體存取指令）
- 若沒有 Smrnmi 保護機制，那 double trap 就是「無解錯誤」
  - 為了安全，系統會馬上凍結該 hart，不再執行任何指令，且中斷全關
  - critical-error 是一種硬體訊號，讓整個 SoC 或系統知道有嚴重錯誤發生  
:::

當在 M-mode 執行 `MRET` 或 `SRET` 指令時，會將 `MDT` 位元設為 0。 若新的權限模式為 U、VS 或 VU，則 `sstatus.SDT` 也會被設為 0。 此外，若新的模式是 VU，則 `vsstatus.SDT` 也會被設為 0

`MNRET` 指令（由 Smrnmi extension 提供）會在新的權限模式不是 M 的情況下，將 `MDT` 位元設為 0。 若新的模式是 U、VS 或 VU，則 `sstatus.SDT` 也會設為 0。 此外，若新模式是 VU，則 `vsstatus.SDT` 也會設為 0

::: tip  
將 `xDT` 設為 0 的用意在於表示該權限下的 trap critical 區段已結束，可以重新允許中斷  
:::

#### 3.1.6.3. Base ISA Control in `mstatus` Register

對於 RV64 的 hart，`SXL` 與 `UXL` 欄位是 WARL 的欄位，分別用來控制 S-mode 與 U-mode 的 XLEN 值。 這些欄位的編碼方式與 `misa` 中的 `MXL` 欄位相同（見上方表 9）。 S-mode 與 U-mode 中實際生效的 XLEN 被稱為 SXLEN 與 UXLEN

當 MXLEN 的值為 32 時，`SXL` 與 `UXL` 欄位不存在，此時 SXLEN 為 32、UXLEN 也為 32。 當 MXLEN 為 64 時，若系統不支援 S-mode，則 `SXL` 是唯讀的 0。 否則，`SXL` 是 WARL 的欄位，用來編碼目前的 SXLEN 值。 某些實作可能會讓 `SXL` 成為唯讀欄位，並保證 SXLEN 與 MXLEN 相等

當 MXLEN 為 64 時，若系統不支援 U-mode，則 `UXL` 是唯讀的 0。 否則，`UXL` 是 WARL 的欄位，用來編碼目前的 UXLEN 值。 某些實作可能會讓 `UXL` 成為唯讀欄位，並保證 `UXLEN=MXLEN` 或 `UXLEN=SXLEN`。 若實作中有支援 S-mode，則 `UXL` 欄位所允許的合法值不能使 UXLEN 大於 SXLEN

當任何模式的 XLEN 被設為小於該 hart 所支援的最大位元寬度時，所有操作都必須忽略來源暫存器中超出 XLEN 的位元，並且必須將運算結果做符號延伸（sign-extend）填滿整個最大位元寬度的目的暫存器。 同樣地，超出 XLEN 的 `pc` 位元也會被忽略，而當寫入 `pc` 時，也必須做符號延伸填滿最大支援的 XLEN

::: tip  
- XLEN 是該 mode 下的寄存器與地址的位數
- `SXL=1` 表示 `SXLEN=32`，`SXL=2` 表示 `SXLEN=64`（與 MXL 的編碼一致）
  - 若不支援 S-mode，硬體就會讓 `SXL=0`（即沒有 S-mode）
- U-mode 可設為 32 或 64-bit，但不能高於上層模式
  - 以防止低權限模式處理比高權限模式更寬的資料，避免潛在風險
  - 為了安全與一致性，有些實作會讓 U-mode 永遠跟 S 或 M 的位數相同

第四段是在說，假設在 RV64 下以 32-bit 模式執行時：

- 所有運算只看低 32-bit 的輸入
- 結果要延伸為 64-bit（保留正負號）
- `pc` 也一樣：忽略高位、寫入時延伸  
:::

::: info  
標準要求所有操作必須將底層硬體暫存器的整個寬度填入定義好的值，以避免產生實作定義的行為。 為了降低硬體複雜度，實作的架構可能不會強制檢查低權限模式的 XLEN 是否小於或等於其上層權限模式的 XLEN。 實務上，這種設定幾乎都是軟體錯誤，但就算出現這種情況，機器的行為依然有明確定義  
:::

某些 HINT 指令被編碼成整數運算指令時，會將目的暫存器覆寫為其當前值，例如 `c.addi x8, 0`。 當這類 HINT 在 `XLEN < MXLEN` 的情況下執行，且目的暫存器的 `MXLEN..XLEN` 這段位元不是全都等於第 `XLEN-1` 位時，實作可以選擇是否要保留 `MXLEN..XLEN` 這段位元不變，或以第 `XLEN-1` 位元的複本覆蓋

::: info  
這種定義允許實作在某些 HINT 指令上略過寫回暫存器的動作，同時也允許它們用與其他整數運算指令相同的方式來執行其他 HINT。 這種實作選擇只會被 XLEN 設定比目前模式更寬的高權限模式觀察到，對當前權限模式是不可見的  
:::

::: tip  
HINT 指令是一種「無作用指令」，常用來對 CPU 下 hint 或佔位。 上方在說的是，假設於 RV64 上用 32-bit 模式執行，那暫存器中高 32 位的處理方式可能會有所不同，有些實作可能忽略高位（保留原值），有些可能會做 sign-extension

系統可以選擇省略 HINT 的實際寫入行為來節省功耗，但對更高權限的模式來說，它可能會觀察到暫存器高位是否有所變化。 但對執行該 HINT 的 mode 本身來說，這不會造成行為差異（故合法）  
:::

#### 3.1.6.4. Memory Privilege in `mstatus` Register

`MPRV`（Modify PRiVilege）位元會改變 load 和 store 指令的實際執行權限等級。 當 `MPRV=0` 時，load 和 store 會依照當前權限模式來執行對應的位址轉換與保護機制。 當 `MPRV=1` 時，load 和 store 的記憶體位址會以 `MPP` 所指定的權限模式進行位址轉換、保護與位元端序處理，而非當前權限模式。 指令的位址轉換與保護則不受 `MPRV` 的影響。 若不支援 U-mode，`MPRV` 為唯讀的 0。 當 `MRET` 或 `SRET` 指令將權限模式切換為低於 M-mode 的模式時，也會將 `MPRV` 設為 0

::: tip  
`MPRV=1` 時，即便程式目前在 M-mode，load/store 會用 `MPP`（可能是 S 或 U）的權限執行，這可用來模擬 user-mode 行為，像是 kernel 模擬存取使用者資料，但指令的 fetch 還是會用目前權限模式來處理，不會因 `MPRV` 改變  
:::

`MXR`（Make eXecutable Readable）位元會改變 load 指令對虛擬記憶體的存取判定。 當 `MXR=0` 時，只有標記為可讀（`R=1`）的 page 能被成功讀取。 當 `MXR=1` 時，標記為可讀或可執行（`R=1` 或 `X=1`）的 page 都能被成功讀取。 當系統沒有啟用以 page 為基礎的虛擬記憶體機制時，`MXR` 沒有作用。 若系統不支援 S-mode，`MXR` 為唯讀的 0

::: info  
`MPRV` 與 `MXR` 機制的設計目的是為了提升 M-mode routine 模擬硬體缺失功能（例如未對齊的 load/store）時的效率。 `MPRV` 省去了在軟體中手動做位址轉換的需求，`MXR` 則允許從僅標記為可執行的 page 讀取指令內容

目前的權限模式與 `MPP` 所指定的權限模式可能有不同的 XLEN 設定。 當 `MPRV=1` 時，load 和 store 的記憶體位址會依照 `MPP` 模式下的 XLEN 來處理，遵循第 3.1.6.3 節中的規則
:::

`SUM`（permit Supervisor User Memory access）位元會改變 S-mode 在執行 load 和 store 時對虛擬記憶體的存取權限判定。 當 `SUM=0` 時，S-mode 若要存取 U-mode 可存取的 page（即該 page 的 U 位為 1）會發生 fault。 當 `SUM=1` 時，這類存取則會被允許。 若系統未啟用以 page 為基礎的虛擬記憶體，則 `SUM` 沒有作用。 需要注意的是，雖然 `SUM` 通常在不處於 S-mode 執行時會被忽略，但當 `MPRV=1` 且 `MPP=S` 時，SUM 依然會生效。 若系統不支援 S-mode，或 `satp.MODE` 為唯讀的 0，則 SUM 為唯讀的 0

`MXR` 與 `SUM` 機制僅影響如何解讀 page table entry 中編碼的權限位元，它們不會影響是否因為 `PMA` 或 `PMP` 而觸發 access-fault 例外

::: tip  
- 通常 supervisor mode 不應隨意存取 user page，除非刻意允許。 開啟 `SUM=1` 可以讓 kernel 直接訪問使用者記憶體（例如在執行 `copy_from_user()` 時）； 但關閉 `SUM=0` 可以增加安全性，避免 kernel 不小心碰到使用者記憶體而導致漏洞
- page table 的權限 ≠ 整體權限。 `MXR`/`SUM` 只管 `PTE` 裡的 `R`/`X`/`U` 權限位如何判定，不影響硬體層的其他權限保護
- PMA（Physical Memory Attribute）與 PMP（Physical Memory Protection）是較底層的機制，即便 page-table 說可以讀，如果 PMP 說不行，那還是會產生 fault  
:::

#### 3.1.6.5. Endianness Control in `mstatus` and `mstatush` Registers

`mstatus` 和 `mstatush` 中的 `MBE`、`SBE`、`UBE` 位元是 WARL 的欄位，用來控制「非 instruction fetch」的記憶體存取的位元端序（endianness）。 instruction fetch 始終是用 little-endian

`MBE` 用來控制當處於 M-mode（且 `mstatus.MPRV=0`）時，非指令抓取的記憶體存取是使用 little-endian (`MBE=0`) 還是 big-endian (`MBE=1`)； 若系統不支援 S-mode，則 `SBE` 為唯讀的 0。 否則，`SBE` 用來控制當處於 S-mode 時，明確執行的 load 與 store 指令是採用 little-endian (`SBE=0`) 還是 big-endian (`SBE=1`)； 若系統不支援 U-mode，則 `UBE` 為唯讀的 0。 否則，`UBE` 用來控制當處於 U-mode 時，明確執行的 load 與 store 指令是採用 little-endian (`UBE=0`) 還是 big-endian (`UBE=1`)

對於如 page table 等 supervisor-level 的記憶體管理資料結構所進行的「隱式存取」，其端序始終由 `SBE` 控制。 由於變更 `SBE` 會改變硬體對這些資料結構的解讀方式，若在 `SBE` 變更期間仍有這些資料結構在使用中，M-mode 軟體必須在變更 `SBE` 後執行 `SFENCE.VMA x0, x0` 指令

::: info  
只有在刻意構造的情境中，某一記憶體管理資料結構才會同時以 little-endian 與 big-endian 兩種方式來解讀。 實務上，`SBE` 僅會在執行「world switch」（如不同 OS 間切換）時於執行期變更，此時並不會重新以不同的端序解讀原本或新的資料結構。 因此除了 world switch 本來就需要執行的 `SFENCE.VMA` 外，不需額外執行一次  
:::

::: tip
「world switch」類似 hypervisor 切換 guest OS，可能需改變端序以配合不同作業系統。 為效能考量，標準允許這種「只在切換時改變」而非中途變更資料解讀方式的情境  
:::

若系統支援 S-mode，則實作可以讓 `SBE` 成為 `MBE` 的唯讀複本。 若系統支援 U-mode，則實作可以讓 `UBE` 成為 `MBE` 或 `SBE` 的唯讀複本

:::: info  
若 `MBE`、`SBE`、`UBE` 皆為唯讀的 0，則表示該實作僅支援 little-endian 記憶體存取。 若 `MBE` 為唯讀的 1，且在支援 S-mode 與 U-mode 的情況下 `SBE` 與 `UBE` 也皆為唯讀的 1，則表示該實作僅支援 big-endian 記憶體存取（指令抓取除外）

Volume I 將 hart 的位址空間定義為一個大小為 $2^{\text{XLEN}}$ bytes 且位址連續的環狀序列。 位址與 byte location 之間的對應關係是固定的，不會受到端序模式的影響。 端序模式只會決定多位元組資料（例如 halfword、word 等）在記憶體中位元組的映射順序

::: tip  
換句話說，地址編號不會變，只有「同一個數值在記憶體中是從高位放前還是後」會變。 這定義可確保 CPU 對所有記憶體地址行為一致，只有資料解釋方式不同  
:::

標準的 RISC-V ABI 預期僅支援 pure little-endian 或 pure big-endian，不支援混合端序。 不過，架構仍定義了端序控制機制，允許例如一個使用某種端序的作業系統執行另一種端序的 user-mode 程式。 設計上也考慮到了某些非標準用途，例如讓軟體依需求動態切換記憶體存取的端序

RISC-V 的指令格式固定為 little-endian，目的是將指令編碼與當前的端序設定解耦，這對硬體與軟體皆有好處。 否則，例如 assembler 或 disassembler 就必須隨時知道目前的端序模式，即使執行期間該端序可能會動態變更。 相對地，若指令端序固定，就能讓某些經過特別撰寫的軟體在二進位層級達到端序無關的效果，類似位置無關（position-independent）的程式碼

然而，將指令固定為 little-endian 的設計對於需編碼或解碼指令的 RISC-V 軟體仍有影響。 在 big-endian 模式下，這類軟體必須注意，顯式執行的 load 與 store 的端序會與指令的端序相反，因此可能需要在 load 後與 store 前進行位元組順序的轉換  
::::

#### 3.1.6.6. Virtualization Support in `mstatus` Register

`TVM`（Trap Virtual Memory）是個 WARL 的欄位，用來攔截 supervisor 的虛擬記憶體管理操作。 當 `TVM=1` 時，若在 S-mode 執行期間嘗試讀寫 `satp` CSR，或執行 `SFENCE.VMA` 或 `SINVAL.VMA` 指令，會觸發 illegal-instruction exception。 當 `TVM=0` 時，這些操作在 S-mode 是被允許的。若系統不支援 S-mode，`TVM` 為唯讀的 0

::: tip
- `satp` CSR 是用來設定虛擬記憶體的 page table base address 與模式的控制暫存器
- `TVM` 這個位元讓 hypervisor 可以攔截 guest OS 針對虛擬記憶體的操作，例如修改 `satp` 或執行 TLB flush。 透過這種方式，hypervisor 可以控制 guest OS 對 page table 的管理，以便延遲或同步更新 shadow page table
:::

:::: info  
TVM 機制透過允許 guest OS 執行於 S-mode 上（而非傳統上使用 U-mode 虛擬化）來提升虛擬化效能。 這種方式免除了大多數攔截 S-mode CSR 存取的需求

透過攔截對 `satp` 的存取，以及攔截 `SFENCE.VMA` 與 `SINVAL.VMA` 這兩個指令，便能夠提供延遲建立 shadow page table 的切入點

::: tip  
- Shadow page table 是 hypervisor 管理虛擬記憶體的一種技巧，它將 guest 的虛擬記憶體對應到 host 的實體記憶體
- Lazy populate 表示「延遲填入」，直到 guest OS 嘗試切換記憶體上下文時才動態建立對應的 shadow page table
- 當 guest OS 要寫 `satp` 或做 TLB 同步操作時，就會觸發 trap，hypervisor 可以在那時建立或更新 shadow page table  
:::  
::::

`TW`（Timeout Wait）位元是個 WARL 的欄位，用來攔截 `WFI` 指令（詳見第 3.3.3 節）。 當 `TW=0` 時，除非有其他原因禁止，否則在低權限模式下仍可執行 `WFI`。 當 `TW=1` 時，若在低權限模式下執行 `WFI`，且在實作所定義的有限時間內未完成，該指令會觸發 illegal-instruction exception。 某些實作在 `TW=1` 時，可能會選擇讓所有低權限下的 `WFI` 都立即觸發 exception，即使當下由於中斷被全域禁止（`xIE=0`），而有正在等待觸發地中斷也一樣。 若系統中沒有比 M-mode 更低的權限模式，則 `TW` 為唯讀的 0

::: tip
> 即使當下由於中斷被全域禁止（`xIE=0`），而有正在等待觸發地中斷也一樣

如果有中斷源觸發中斷，但 `xIE = 0`，此時中斷會被「暫時擱置（pending）」，不會馬上進入 trap handler。 而這句話的意思是，在 `WFI` 執行的當下，即使有某個中斷事件發生，但因為全域中斷 enable 的位元（如 `MIE`）是關掉的，導致那中斷可能等等才會被處理，在這種情況下，`WFI` 一樣會觸發 illegal-instruction exception（如果 `TW=1`）  
:::

::: info  
攔截 `WFI` 指令可用來觸發 world switch（世界切換）到另一個 guest OS，而非讓目前的 guest 白白空轉  
:::

當系統實作有支援 S-mode 時，在 U-mode 下執行 `WFI` 指令會導致 illegal-instruction exception，除非該指令能在實作定義的某個有限時間內完成。 未來的版本可能會加入某個功能，以允許 S-mode 能夠選擇性地允許 U-mode 執行 `WFI`，但這種功能只有在 `TW = 0` 時才會生效

`TSR`（Trap SRET）位是一個 WARL 的欄位，用來支援攔截 S-mode 的例外返回指令 `SRET`。 當 `TSR = 1` 時，在 S-mode 執行 `SRET` 會觸發 illegal-instruction exception。 當 `TSR = 0` 時，S-mode 可以正常執行 `SRET`。 若系統不支援 S-mode，則 TSR 為唯讀的 0

::: info  
在不支援 hypervisor extension 的實作中，攔截 `SRET` 是模擬 hypervisor 功能所必需的  
:::

#### 3.1.6.7. Extension Context Status in `mstatus` Register

支援大量擴充功能是 RISC-V 的主要目標之一，因此我們定義了一個標準介面，讓特權模式下的程式碼（特別是 supervisor 等級的作業系統）在不需修改的情況下，就能支援任意的 user-mode 狀態擴充

::: info  
截至目前，V extension（向量擴充）是唯一一個在 floating-point CSR 與資料暫存器之外，還額外定義狀態的標準擴充  
:::

`FS[1:0]` 和 `VS[1:0]` 是 WARL 的欄位，`XS[1:0]` 是唯讀的欄位，它們的目的是透過追蹤目前 floating-point 單元與其他 user-mode 擴充的狀態來減少 context save/restore 的成本。 `FS` 欄位編碼了浮點單元的狀態，包括 `f0–f31` 的浮點暫存器，以及 `fcsr`、`frm`、`fflags` 這三個 CSR。 `VS` 欄位編碼了 vector 擴充的狀態，包括 `v0–v31` 的向量暫存器，以及 `vcsr`、`vxrm`、`vxsat`、`vstart`、`vl`、`vtype`、`vlenb` 這些 CSR。 `XS` 欄位編碼了其他 user-mode 擴充及其對應狀態的狀態資訊

::: tip  
每次發生 context switch（如中斷或 task 切換）時 OS 都需要儲存/還原使用者狀態，透過 `FS` 和 `VS` 欄位可以知道這些狀態是否被使用過，如果沒被使用就可以省略 save/restore 動作。 `XS` 用來代表其他自訂 user-mode 擴充的狀態是否有作用  
:::

這些欄位可供 context switch routine 查閱，以快速判斷是否需要進行狀態的儲存或還原。 若需要儲存/還原，則通常會需要額外的指令或 CSRs 來完成或優化這個流程。

::: info  
這個設計預期大多數的 context switch 不需要儲存/還原 floating-point 的單元或其他擴充的狀態，因此提供了一個 `SD` 位元（State Dirty）作為快速檢查用途  
:::

`FS`、`VS`、與 `XS` 這三個欄位都使用與 Table 11 相同的狀態編碼，其有四種可能的狀態值，分別是 `Off`、`Initial`、`Clean`、與 `Dirty`：

<span class = "center-column">

| Status | FS and VS Meaning | XS Meaning                              |
|--------|-------------------|-----------------------------------------|
| 0      | Off               | All off                                 |
| 1      | Initial           | None dirty or clean, some on            |
| 2      | Clean             | None dirty, some clean                  |
| 3      | Dirty             | Some dirty                              |

（Table 11. Encoding of FS[1:0], VS[1:0], and XS[1:0] status fields）

</span>

如果實作支援 F extension，那麼 `FS` 欄位不能是唯讀的 0。 如果系統同時不支援 F extension 與 S-mode，那麼 `FS` 為唯讀的 0。 如果有支援 S-mode 但沒支援 F extension，那麼 `FS` 欄位可以選擇是否要為唯讀的 0

:::: info  
對於支援 S-mode 但不支援 F extension 的實作，標準允許（但不強制）將 `FS` 設為唯讀的 0。 有些實作會選擇不把 `FS` 設成唯讀的 0，這樣才能讓 S-mode 和 U-mode 透過進入 M-mode 的「invisible trap」來模擬 F extension

::: tip  
這樣的設計可以讓作業系統以為有 F extension，實際上所有浮點操作都會進 trap 交給 M-mode 模擬，此時 OS 仍需要追蹤 `FS` 的狀態變化，因此 `FS` 就不能是唯讀的 0  
:::  
::::

如果實作中有提供向量暫存器 `v`，那麼 `VS` 欄位就不能是唯讀的 0。 如果系統中既沒有暫存器 `v`，也不支援 S-mode，那麼 `VS` 為唯讀的 0。 如果有 S-mode 但沒有暫存器 `v`，那麼 `VS` 可以選擇是否要為唯讀的 0

在沒有額外 user-mode 擴充（需要保存狀態）的 hart 中，`XS` 欄位是唯讀的 0。 每個具有狀態的額外擴充都會提供一個 CSR 欄位，來編碼與 `XS` 對應的狀態。 `XS` 是用來彙總所有這些擴充狀態的摘要資訊，如上方 Table 11 所示

::: info  
`XS` 欄位的值會反映所有 user 擴充狀態中最高的狀態等級（例如只要有 `Dirty` 就是 `Dirty`）。 不過個別的擴充可以用和 `XS` 不同的編碼格式來表示自己的狀態  
:::

`SD` 位元是一個唯讀的位元，用來總結 `FS`、`VS` 或 `XS` 中是否有任何一個欄位為 dirty 的狀態，必須將擴充的 user context 儲存到記憶體中。 若 `FS`、`VS`、`XS` 全部都是唯讀的 0，那麼 `SD` 也必定是 0

當某個 extension 的狀態被設為 `Off` 時，任何試圖讀寫該 extension 狀態的指令都會觸發 illegal-instruction exception。 當狀態是 `Initial` 時，該 extension 的狀態應該具有某個預設常數值。 若為 `Clean`，表示目前的狀態可能已與初始值不同，但與上次儲存 context 時的值一致。 若為 `Dirty`，代表自從上次儲存 context 後，狀態可能已經被改變了

::: tip
每次 context switch，作業系統會根據 `FS`/`VS`/`XS` 等欄位來決定是否要儲存那些 extension 的狀態（像浮點暫存器、vector 暫存器等等）。 因此當你的 context 被 switch out 的時候：

- 若狀態是 `Dirty` → 代表你這段期間有「改動」那塊 extension 的狀態
  - 所以當要把你「切出去」（context save）時，要把你「改過的內容」儲存下來，如 `f0`~`f31`
- 若狀態是 `Clean` → 表示你沒有動那塊狀態，自上次儲存以來都沒改過
  - 所以你在這次被切出去時就不需要再重新儲存（因為上次儲存的版本就還有效）  
:::

在儲存 context 時，只有當狀態為 `Dirty` 時，負責的高權限程式碼才需要將該狀態寫入記憶體，然後可以把 extension 狀態重設為 `Clean`。 在還原 context 時，只有當狀態是 `Clean` 時才需要從記憶體載入狀態（在還原階段，狀態不應該是 `Dirty`）。 如果狀態是 `Initial`，為了避免安全性問題，還原 context 時必須將其設為初始常數值，但這不需要存取記憶體，舉例來說，可以將浮點暫存器全部初始化為立即值 0

高權限程式碼會在儲存 context 前讀取 `FS` 與 `XS` 欄位。 在回復 user context 時，高權限程式碼會直接設定 `FS`，而 `XS` 是透過寫入各個 extension 的狀態暫存器時間接設定的。 無論當下的權限模式為何，這些狀態欄位也都可能會在執行指令期間自動更新

User-mode ISA 的擴充常常會包含額外的 user-mode 狀態，這些狀態可能遠比基本的整數暫存器多，而且可能只有某些應用才會使用這些擴充，或只會在某些短暫的階段用到。 為了提升效能，user-mode 擴充可以定義額外的指令，讓 user-mode 軟體可以將單元重設為初始狀態，甚至直接關閉該單元

例如，一個 coprocessor 使用前可能需要先被 configure，用完之後則可以 unconfigure。 unconfigure 狀態在 context 儲存時會被視為 `Initial`。 如果在 unconfigure 和下一次 configure 的期間，執行的還是同一個應用程式，那就不需要真的在 unconfigure 時初始化狀態，因為這些狀態對那個 process 來說是本地的。 也就是說，設定為 `Initial` 只會導致 context restore 時將 coprocessor 狀態設為常數值，而不需要在每次 unconfigure 時都初始化

::: tip  
「unconfigure」會把 coprocessor 狀態標記成 `Initial`。 按照 RISC-V 的設計，`Initial` 表示「這個狀態在 context restore 時才需要被初始化為固定常數值（例如 0）」，但如果程式本身沒被切出去，還在持續跑，那就不需要真的花時間去 reset，因為狀態還會繼續被使用  
:::

當執行一條 user-mode 的指令將某個單元（如浮點或向量單元）關閉並將其設為 Off 的狀態後，若之後有其他指令試圖在這單元尚未重新啟用前使用它，則會觸發 illegal-instruction exception。 若某個 user-mode 指令要重新開啟這個單元，也必須確保該單元的狀態已正確初始化，因為在這段期間內可能已經有其他 context 使用過這個單元了

修改 `FS` 的設定不會影響浮點暫存器狀態的內容。 具體來說，把 `FS` 設成 Off 並不會抹除暫存器的內容，把 `FS` 設成 `Initial` 也不會清除它。 `VS` 的設定也同樣不會影響向量暫存器的內容。 不過對於其他的 extension，在設為 Off 時其可能會選擇不保留其狀態

實作上可以用不精確地方式來追蹤浮點暫存器的 `Dirty` 狀態，例如即使其內容沒有被修改，也直接將其標記為 `Dirty`。 某些實作中，即便是沒改變浮點狀態的指令，也可能會導致狀態從 `Initial` 或 `Clean` 轉變為 `Dirty`。 而有些實作甚至完全不追蹤 `Dirty` 狀態，此時 `FS` 僅會出現 `Off` 和 `Dirty` 兩種狀態，若試圖把 `FS` 設為 `Initial` 或 `Clean`，實際上會變成 `Dirty`

::: info  
`FS` 可能會因為錯誤的 speculative execution 而被意外寫成 `Dirty`。 有些平台會選擇禁止 speculative execution 對 `FS` 進行寫入操作，以防潛在的 side channel  
:::

若 `FS` 是 `Initial` 或 `Clean` 的，此時如果某指令對浮點暫存器或 `fcsr` 進行了明確或隱式的寫入，但其實沒有改變內容，則實作可以自行定義是否要讓 `FS` 轉變為 `Dirty`

對向量暫存器的 `Dirty` 狀態，實作也可以採用類似不精確的方式來追蹤，例如在軟體試圖將 `VS` 設為 `Initial` 或 `Clean` 時，實際上會直接將其設成 `Dirty` 等。 當 `VS` 為 `Initial` 或 `Clean` 時，若某個指令寫入了向量暫存器或 CSR，但沒改變其內容，則實作也可以自行定義是否要讓 `VS` 轉變為 `Dirty`

表格 12 顯示了 `FS`、`VS` 和 `XS` 狀態位元的所有可能狀態轉移。 注意，標準的浮點與向量 extension 並不支援 user-mode 的 unconfigure 或 enable/disable 等用來切換狀態的指令：

<span class = "center-column">

| <span class = "purple">**Current State / Action**</span> | <span class = "purple">**Off**</span>     | <span class = "purple">**Initial**</span> | <span class = "purple">**Clean**</span>   | <span class = "purple">**Dirty**</span>   |
|----------------------------|-------------|-------------|-------------|-------------|
| <span class = "purple">**At context save in privileged code**</span> |||||
| Save state?                | No          | No          | No          | Yes         |
| Next state                 | Off         | Initial     | Clean       | Clean       |
| <span class = "purple">**At context restore in privileged code**</span> |||||
| Restore state?            | No          | Yes, to initial | Yes, from memory | N/A      |
| Next state                | Off         | Initial     | Clean       | N/A         |
| <span class = "purple">**Execute instruction to read state**</span> |||||
| Action?                   | Exception   | Execute     | Execute     | Execute     |
| Next state                | Off         | Initial     | Clean       | Dirty       |
| <span class = "purple">**Execute instruction that possibly modifies state, including configuration**</span> |||||
| Action?                   | Exception   | Execute     | Execute     | Execute     |
| Next state                | Off         | Dirty       | Dirty       | Dirty       |
| <span class = "purple">**Execute instruction to unconfigure unit**</span> |||||
| Action?                   | Exception   | Execute     | Execute     | Execute     |
| Next state                | Off         | Initial     | Initial     | Initial     |
| <span class = "purple">**Execute instruction to disable unit**</span> |||||
| Action?                   | Execute     | Execute     | Execute     | Execute     |
| Next state                | Off         | Off         | Off         | Off         |
| <span class = "purple">**Execute instruction to enable unit**</span> |||||
| Action?                   | Execute     | Execute     | Execute     | Execute     |
| Next state                | Initial     | Initial     | Initial     | Initial     |

（Table 12. `FS`, `VS`, and `XS` state transitions）

</span>

系統提供標準的特權指令來初始化、儲存與還原 extension 狀態，透過將該狀態視為不透明物件的方式，使 S-mode 的程式碼不需要了解所新增 extension 狀態的細節。 

:::: info
許多 coprocessor extension 只會於有限的情境中被使用，因此軟體可以在使用完後安全地取消設定，甚至停用這些單元。 這能減少大型、有狀態的 coprocessor 所帶來的 context switch 負擔

::: tip  
「取消設定（unconfigure）」與「停用（disable）」是指讓這些單元進入 `Initial` 或 `Off` 狀態，如此可以避免在 context switch 時不必要地儲存與還原這些不再使用的狀態  
:::

標準將浮點狀態與其他 extension 狀態區分開來，是因為當系統有浮點單元時，浮點暫存器是標準呼叫慣例的一部分，其不能像其他 extension 一樣輕易地被停用，因此 user-mode 的軟體無法得知何時可以安全地停用浮點單元  
::::

`XS` 欄位提供所有新增 extension 狀態的總結資訊，但 extension 本身可能會維護額外的微架構位元，以進一步減少 context 儲存與還原的負擔。 `SD` 是唯讀位元，當 `FS`、`VS` 或 `XS` 中任一欄位處於 `Dirty` 的狀態（例如 `SD = (FS == 0b11 OR XS == 0b11 OR VS == 0b11)`）時，`SD` 會被設為 1。 這讓 privileged code 可以快速判斷是否要儲存除了整數暫存器與 `pc` 以外的 context

浮點單元的狀態總是透過標準指令（`F`、`D` 和/或 `Q`）來初始化、儲存與還原，而 privileged code 必須知道 FLEN 的值，以決定每個 `f` 暫存器應保留多少空間

::: tip  
FLEN 表示浮點暫存器的實體寬度（例如 32、64、128）  
:::

Machine mode 和 Supervisor mode 共用同一組 `FS`、`VS` 與 `XS` 位元。 Supervisor-level 的軟體通常會直接使用這些欄位來紀錄那些和它所儲存的 context 對應的狀態。 而 Machine-level 的軟體在儲存與還原其對應版本的 extension 狀態時，必須採取更保守的作法

:::: info  
在任何合理的使用情境中，user 與 supervisor 之間的 context switch 次數應該遠多於切換到其他特權層的次數。 請注意，coprocessor 不應要求在處理非同步中斷時儲存與還原其 context，除非該中斷會導致 user-level context 的切換

:::  tip  
對於第二句話，是因為大部分中斷的處理不會影響使用者層的執行狀態。 許多中斷（像是硬體計時器、I/O 完成中斷）只是要求 OS 執行一些簡單的管理任務，例如更新排程器、收發資料或清除旗標等。 這些任務通常不會直接切換到另一個 user process，也不需要觸及 user-mode extension（像是浮點暫存器、vector 暫存器等）

加上這些 extension 的狀態都屬於 user process 的 context，只要中斷結束後還是回到原本的 user process，那 extension 狀態根本不用動。 所以第二句話才說如果只是處理中斷，不用切出 user process，那就不要動 extension 的狀態； 而如果中斷導致了 process 的切換，那才會需要依照 `FS`、`VS`、`XS` 的 Dirty 狀態來判斷要不要儲存 extension 的狀態  
:::  
::::

#### 3.1.6.8. Previous Expected Landing Pad (ELP) State in `mstatus` Register

Zicfilp extension 新增了 `SPELP` 和 `MPELP` 欄位，這兩個欄位會記錄之前的 `ELP`，並根據第 22.1.2 節中的說明進行更新。 `xPELP` 欄位的編碼如下：

- `0`：`NO_LP_EXPECTED`，預期接下來「不」會有 landing pad 指令
- `1`：`LP_EXPECTED`，預期接下來會有 landing pad 指令

### 3.1.7. Machine Trap-Vector Base-Address (`mtvec`) Register

`mtvec` 暫存器是一個 MXLEN-bit 的 WARL 類型可讀寫暫存器，用來儲存 trap vector 的設定，包含一個向量基底位址（BASE）以及向量模式（MODE）

![](image/mtvec.png)

`mtvec` 暫存器必須被實作，但其內容可以被設為唯讀的。 若該暫存器可寫，其可接受的值範圍會依照實作而有所不同。 BASE 欄位的值必須對齊至 4-byte 邊界，而 MODE 的設定可能會對 BASE 的對齊提出更嚴格的限制。 請注意，CSR 中只包含 BASE 位址的第 `XLEN-1` 到第 `2` 位元。 實際作為位址使用時，最低的兩個位元會自動補 0，以形成一個符合 4-byte 對齊要求的 XLEN-bit 位址

::: info  
標準在 trap vector 基底位址的設計上提供了高度的彈性。 一方面，我們不希望低階實作需要儲存太多額外狀態； 另一方面，我們也希望保有對大型系統的靈活支援能力
:::

<span class = "center-column">

| Value | Name     | Description                                               |
|-------|----------|-----------------------------------------------------------|
| 0     | Direct   | All traps set `pc` to BASE                                |
| 1     | Vectored | Asynchronous interrupts set `pc` to BASE + 4 × cause      |
| ≥2    | ---      | *Reserved*                                                |

（Table 13. Encoding of mtvec MODE field.）

</span>

MODE 欄位的編碼方式如表 13 所示。 當 MODE 設為 `Direct` 時，所有進入 machine mode 的 trap 都會把 `pc` 設定為 BASE 欄位中的位址。 而當 MODE 設為 `Vectored` 時，所有同步例外依然會跳到 BASE，但中斷則會跳到 BASE 加上中斷原因編號乘以 4 的偏移位址。 例如，一個 machine mode 的 timer 中斷（見表 14）會讓 `pc` 被設為 `BASE + 0x1c`

不同的實作可能會對不同的模式有不一樣的對齊要求。 特別是 `Vectored` 模式可能會比 `Direct` 模式要求更嚴格的對齊

::: info  
在 `Vectored` 模式中採用較粗的對齊，可以讓 vectoring 的實作在硬體上不需要加法器。 Reset 和 NMI 的向量位址則由平台規格來指定  
:::

::: tip  
RISC-V 處理 trap（包含例外與中斷）時，會根據 `mtvec` 的設定來決定要跳到哪裡執行 trap handler。 而這個跳躍方式由 `mtvec` 的 MODE 欄位所控制：

- `MODE = 0`（Direct）：無論是同步例外還是中斷，都跳到 BASE 指定的同一個位址
- `MODE = 1`（Vectored）：
  - 同步例外（exception）仍跳到 BASE
  - 中斷（interrupt）會跳到 `BASE + 4 × cause`（cause 為中斷原因的編號）

所以這是設計 trap handler 分派機制的方式，目的是給作業系統一個機制來處理不同中斷來源的函式（類似 interrupt vector table 的概念）

而因為 `Vectored` 模式會跳到 `BASE + 4 × cause`，所以硬體會把 BASE 當成一個跳躍表的起點，每個 entry 間隔 4 bytes。 如果 BASE 本身不是某種對齊的話，可能會讓硬體在實作上變複雜，需要額外的加法器來做位址計算。 
因此，RISC-V 規範才允許不同的實作針對不同的 MODE 設計出「不同的對齊限制」。

例如：

- `Direct` 模式只需要 BASE 是 4-byte 對齊就夠了（因為就跳去那裡執行）
- `Vectored` 模式可能會要求 BASE 是 128-byte 對齊，這樣就可以用簡單的移位運算而非加法器來找出第 n 個 handler 的位址（`cause << 2`）  
:::

### 3.1.8. Machine Trap Delegation (`medeleg` and `mideleg`) Registers

預設情況下，所有 privilege level 所產生的 trap 都會由 machine mode 處理。 不過 machine-mode 的 handler 可以透過 `MRET` 指令（見 3.3.2 節）將 trap 回傳給對應的低權限層級。 為了提升效能，實作上可以提供 `medeleg` 和 `mideleg` 這兩個具有個別讀寫位元的暫存器，用來指定哪些例外或中斷可以直接由較低權限層級處理。 machine exception delegation 暫存器（`medeleg`）是 64-bit 的可讀寫暫存器，而 machine interrupt delegation 暫存器（`mideleg`）則是 MXLEN 位元的可讀寫暫存器

在支援 S-mode 的 hart 中，`medeleg` 和 `mideleg` 這兩個暫存器是必要的。 只要設定對應的位元，當 S-mode 或 U-mode 發生對應的 trap，就會被轉交給 S-mode 的 trap handler 處理。 而在不支援 S-mode 的 hart 中，這兩個暫存器就不應該存在

::: tip
delegation 是讓 machine mode 把 trap 權限下放給 S-mode 的機制。 所以如果一個 hart 根本沒支援 S-mode，那麼 `medeleg` 和 `mideleg` 就沒有存在的必要，甚至在硬體上也應該被省略。 注意這裡也提到即使 trap 是在 U-mode 發生的，只要有對應的 delegation，它仍會跳到 S-mode，而不是直接給 U-mode handler  
:::

:::: info  
在版本 1.9.1 與更早的版本中，這些暫存器即便存在，在只有 M-mode，或只有 M/U 而沒有 N 個 hart 的情況下，其值也會固定為零。 但其實沒有必要強制這些情況下的值一定為零，因為 `misa` 暫存器已經能夠指出這些暫存器是否存在

::: tip  
在舊版中，這些暫存器即使存在，也不能改值（等於硬體焊死為 0）。 但後來標準放寬了這個限制，因為是否支援 delegation，可以直接從 `misa` 暫存器查出，而不必限制 `medeleg`/`mideleg` 一定要回傳 0，以讓硬體實作更有彈性  
:::  
::::

當 trap 被委託給 S-mode 時，`scause` 暫存器會寫入 trap 的原因，`sepc` 會寫入觸發 trap 的指令的虛擬位址，`stval` 會寫入與例外相關的額外資訊； `mstatus` 中的 `SPP` 欄位會記錄當下的權限模式，`SPIE` 會寫入當時 `SIE` 的值，而 `SIE` 本身會被清除。 而 `mcause`、`mepc`、`mtval` 以及 `mstatus` 中的 `MPP` 與 `MPIE` 欄位則不會被更新

實作可以選擇只支援部分可委託的 trap。 要確認支援了哪些 bit，可以嘗試把 `medeleg` 或 `mideleg` 的每個位元都設為 1，然後讀回來看哪些位元仍然是 1，就能知道哪些 trap 是可以被委託的

實作上不可以讓 `medeleg` 中的任何位元是唯讀的 1，也就是說，只要是可委託的同步 trap，都必須支援能將其設為「不委託」的狀況。 同樣地，`mideleg` 中對應到 machine-level 中斷的位元，也不能被設成唯讀的 1（但對於較低層級的中斷則可以）

::: tip  
這段是對硬體實作的限制：即使 trap 可以被委託，也必須允許「選擇不委託」，這樣作業系統才能保有控制權。 不能硬把某些中斷永遠委託下去（唯讀的 1），否則會限制 OS 的彈性  
:::

::: info  
在版本 1.11 及更早的版本中，`mideleg` 中的所有位元都被禁止設為唯讀的 1。 另外，平台規範仍可以額外加上自己的限制  
:::

trap 永遠不會從高權限層級轉移給低權限層級處理。 舉例來說，即使 M-mode 已經把 illegal-instruction 的例外委託給 S-mode，當 M-mode 自己執行了非法指令時，這個 trap 還是會在 M-mode 被處理，而不會被委託給 S-mode。 相反地，trap 可以「水平處理」。 同樣的例子中，如果 S-mode 軟體執行了非法指令，那這個 trap 就會在 S-mode 被處理

::: tip  
trap delegation 只能從 machine mode 向下轉交下層權限的 trap，但不能逆向（往下層回傳）。 也就是說，當某個權限層級自己出錯（觸發 exception），它必須自己處理，不會「往下委託」。 但如果是一個較低層級（例如 S-mode 或 U-mode）觸發的 trap，那麼可以透過 `medeleg`/`mideleg` 的設定，決定是否讓該層直接處理，或轉交給 M-mode  
:::

當中斷被委託時，委託者所在的權限層級將會對該中斷進行遮蔽（mask）。 例如，若 supervisor timer interrupt（STI）已透過設定 `mideleg[5]` 委託給 S-mode，那麼在 M-mode 執行期間就不會接收到 STI。 相反地，若 `mideleg[5]` 為清除狀態（未委託），那 STI 就可以在任一權限層級被觸發，並會統一交由 M-mode 處理

::: tip  
這裡說明 delegation 的副作用：一旦將某中斷委託給 S-mode，M-mode 就再也不會接收到這個中斷了。 這是一種設計保證，避免不同層級重複處理同一個 trap。 所以若你將 `mideleg[5]` 設為 1，表示 STI 被委託給 S-mode，那麼即使當下是 M-mode，也會忽略這個中斷  
:::

![（Figure 11. Machine Exception Delegation (`medeleg`) register.）](image/medeleg.png)

`medeleg` 對應每一種同步例外（如表 14 所示）都分配一個位元位置，這個位元的位置與 `mcause` 暫存器回傳的值相同（例如設定第 8 位元，就代表允許將 user-mode 的環境呼叫交給較低權限的 trap handler 處理）。 當 `XLEN=32` 時，`medelegh` 是一個 32-bit 的可讀寫暫存器，對應到 `medeleg` 的第 63 到 32 位元。 當 `XLEN=64` 時，`medelegh` 不存在

![（Figure 12. Machine Interrupt Delegation (`mideleg`) Register.）](image/mideleg.png)

`mideleg` 儲存的是各個中斷類型的委託設定位元，其位元排列方式與 mip 暫存器相同（例如 STIP 中斷的委託控制位元位於第 5 位）。 對於不可能在低權限模式發生的例外，其對應的 `medeleg` 位元應該是唯讀的 0。 特別是 `medeleg[11]` 要是唯讀的 0； `medeleg[16]` 也要是唯讀的 0，因為 double trap 是不可委託的

::: tip  
`mcause = 11` 是 machine-mode 的 `ecall`，U/S-mode 根本不會觸發這個例外，所以 `medeleg[11]` 被設計成硬體保證為 0  
:::

### 3.1.9. Machine Interrupt (`mip` and `mie`) Registers

`mip` 暫存器是一個 MXLEN 位元的可讀寫暫存器，用來表示目前有哪些中斷已被掛起（pending）； 而 `mie` 是對應的可讀寫暫存器，用來控制各中斷是否啟用。 中斷原因編號 `i`（可參考 `mcause`，見第 3.1.15 節）對應到 `mip` 與 `mie` 中的第 `i` 個位元。 位元 0 到 15 保留給標準中斷使用，而第 16 位以上則保留給平台定義使用

::: info  
保留給平台使用的中斷可以由平台自行定義用途，也可以指定為自訂用途  
:::

![（Figure 13. Machine Interrupt-Pending (`mip`) register.）](image/mip.png)

![（Figure 14. Machine Interrupt-Enable (`mie`) register）](image/mie.png)

一個會讓處理器陷入 M-mode（也就是切換到 M-mode 處理）的中斷 `i` 需滿足下列所有條件：
- (a) 當前權限模式是 M 且 `mstatus` 中的 `MIE` 位元為 1，或當前處於比 M-mode 更低的權限層級
- (b) 中斷編號 `i` 的位元在 `mip` 與 `mie` 中都被設為 1
- (c) 若存在 `mideleg` 暫存器，則 `i` 的對應位元在 `mideleg` 中必須是 0（表示未委託）

::: tip  
1. 權限狀態允許中斷：
    - 若已在 M-mode，還必須 `mstatus.MIE = 1`（中斷總開關）才會進入中斷
    - 若目前在 S-mode 或 U-mode，那就不需要檢查 `mstatus.MIE`，因為中斷都會先升權限進 M-mode 或 S-mode
2. 中斷來源條件成立：
    - `mip[i] = 1` → 中斷來源已經掛起
    - `mie[i] = 1` → 允許該中斷來源
3. 委託情況：
    - 若有 `mideleg[i] = 1`，那這個中斷就會被委託給 S-mode，而不是進 M-mode
    - 反過來說，只有 `mideleg[i] = 0`，才會由 M-mode 處理  
:::

上述中斷 trap 成立的條件，必須在中斷來源在 `mip` 中變成掛起或取消掛起的固定時間內被評估，也必須在執行 `xRET` 指令之後，或對相關 CSR（像是 `mip`、`mie`、`mstatus`、`mideleg`）進行寫入後立即重新評估。 針對 M-mode 的中斷會優先於所有針對較低權限層級的中斷

`mip` 暫存器中的每個位元都可能是可寫的，也可能是唯讀的。 當 `mip` 的第 `i` 位是可寫的時，可以透過寫入 0 來清除中斷 `i` 的掛起狀態。 若中斷 `i` 被掛起，但其在 `mip` 中的對應位元是唯讀的，實作上必須提供其他機制來清除該中斷的掛起狀態

只要某個中斷可能會進入掛起狀態，那麼其對應的 `mie` 位元就必須是可寫的。 那些不可寫的 `mie` 位元必須是唯讀的 0，表示永遠不能啟用該中斷。 `mip` 與 `mie` 暫存器中標準定義的部分（第 0 到 15 位元）格式如圖 15 與圖 16 所示

![（Figure 15. Standard portion (bits 15:0) of `mip`.）](image/mip_portion.png)

![（Figure 16. Standard portion (bits 15:0) of `mie`.）](image/mie_portion.png)

:::: info  
machine-level 的中斷暫存器負責處理少數幾個核心中斷來源，這些來源被指派了固定的服務優先順序以簡化設計。 而外部中斷控制器則可以實作更複雜的優先排序機制，對大量中斷來源進行管理，最後再將它們多工輸入到 machine-level 的中斷來源中

::: tip  
machine-level (`mip`, `mie`) 處理的是「根中斷來源」，如軟體、timer、外部中斷。 外部中斷控制器（如 PLIC）可以管理更多中斷來源（例如 GPIO、UART、Ethernet），PLIC 會根據內部設定的優先權做 arbitration，然後把最高優先權的中斷送到 `MEIP`，這樣 machine-level 就只需要處理一個外部中斷來源了  
:::

不可遮蔽中斷（non-maskable interrupt, NMI）不會透過 `mip` 暫存器顯示，因為在執行 NMI 的 trap handler 時，處理器就會隱含地知道 NMI 已經發生了  
::::

`mip.MEIP` 與 `mie.MEIE` 分別是 machine-level 外部中斷的掛起與啟用位元。 `MEIP` 在 `mip` 中是唯讀的，由平台特定的外部中斷控制器負責設定與清除

`mip.MTIP` 與 `mie.MTIE` 分別是 machine-mode timer 中斷的掛起與啟用位元。 `MTIP` 在 `mip` 中是唯讀的，並透過寫入 memory-mapped machine-mode timer compare 暫存器來清除

`mip.MSIP` 與 `mie.MSIE` 分別是 machine-level 軟體中斷的掛起與啟用位元。 `MSIP` 在 `mip` 中是唯讀的，透過存取記憶體映射的控制暫存器來設定，通常由其他 hart 用來觸發 machine-level 的跨核心中斷（IPI）。 同一個 hart 也可以透過這個記憶體映射的控制暫存器寫入自己的 `MSIP`。 如果系統只有一個 hart，或平台改用外部中斷（`MEI`）提供跨核心中斷，那麼 `mip.MSIP` 與 `mie.MSIE` 可以是唯讀的 0

如果系統沒有實作 supervisor mode，則 `mip` 中的 `SEIP`、`STIP`、`SSIP` 與 `mie` 中的 `SEIE`、`STIE``、SSIE` 這幾個位元都會是唯讀的 0。 若系統實作了 supervisor mode，則 `mip.SEIP` 與 `mie.SEIE` 分別是 supervisor-level 外部中斷的掛起與啟用位元。 `SEIP` 在 `mip` 中是可寫的，M-mode 軟體可以寫入該位元，藉此通知 S-mode 有外部中斷掛起。 此外，平台級的中斷控制器也可以產生 supervisor-level 外部中斷

該中斷的掛起狀態由兩個來源的 logical-OR 操作決定：一是由軟體可寫的 `SEIP` 位元，二是中斷控制器送出的訊號。 在使用 CSR 指令讀取 `mip` 時，所讀到的 `SEIP` 值會是這兩者的 OR 結果； 但在對 `SEIP` 寫入值時，則不會考慮控制器送出的訊號。 只有軟體可寫的 `SEIP` 位元會參與 `CSRRS`/`CSRRC` 等 CSR 指令的讀寫流程

::: info  
舉例來說，若我們將軟體可寫的 `SEIP` bit 稱為 `B`，而外部中斷控制器送入的訊號稱為 `E`，那麼執行 `csrrs t0, mip, t1` 時，`t0[9]` 會被設為 `B || E`，接著 `B` 被寫為 `B || t1[9]`。 若執行 `csrrw t0, mip, t1`，那 `t0[9]` 一樣會設為 `B || E`，而 `B` 則被寫為 `t1[9]`。 在這兩種情況下，`B` 的值都不會受到 `E` 的影響

`SEIP` 的這種行為設計，是為了讓較高權限層級能夠安全地模擬外部中斷，而不會導致真實的外部中斷被忽略。 為此，CSR 指令在處理 `SEIP` 時的行為也針對這個需求做了些微修改
:::

::: tip  
`SEIP` 是一個由兩個來源組成的虛擬位元（OR 結果）。 `mip.SEIP` 可由 M-mode 軟體手動設定（模擬中斷），同時外部中斷控制器也可能送入訊號（真實中斷）。 當你讀取 `mip.SEIP` 時，會看到這兩者的 OR 結果，但當你修改 `mip.SEIP` 時（用 CSR 指令），你只能影響軟體可寫的那個 bit，而無法修改控制器送進來的訊號，這讓 M-mode 可以安全地「模擬」S-mode 中斷，不會蓋掉真實的外部中斷  
:::

若系統支援 supervisor mode，則 `mip.STIP` 與 `mie.STIE` 分別為 S-mode timer 中斷的掛起與啟用位元。 `STIP` 是可寫的，M-mode 軟體可以透過寫入該位元，將 timer 中斷送給 S-mode

若系統支援 supervisor mode，則 `mip.SSIP` 與 `mie.SSIE` 分別為 S-mode 軟體中斷的掛起與啟用位元。 `SSIP` 是可寫的，也可以由平台特定的中斷控制器設為 1

若系統實作了 Sscofpmf 擴充指令集，則 `mip.LCOFIP` 與 `mie.LCOFIE` 為本地計數器溢位中斷的掛起與啟用位元。 `mip.LCOFIP` 是可讀寫的，會在任何一個 `mhpmeventn.OF` 位元被設為 1 時反映中斷請求。 若未實作 Sscofpmf 擴充，則這兩個位元為唯讀的 0

當多個中斷同時指向 M-mode 處理時，它們的優先順序如下（由高到低）：`MEI`、`MSI`、`MTI`、`SEI`、`SSI`、`STI`、`LCOFI`

::: info  
machine-level 中斷的固定優先順序是根據以下原則所設計的：

- 高權限模式的中斷必須比低權限模式的中斷優先處理，以支援搶佔（preemption）
- 位於第 16 位以上的 machine-level 平台特定中斷來源，其優先順序由平台定義，但通常會被設為最高優先，以支援極快速的本地向量化中斷（local vectored interrupts）
- 外部中斷優先於內部中斷（如 timer 與 software），因為外部中斷通常來自需要低延遲服務的裝置
- 軟體中斷優先於內部 timer 中斷，因為 timer 中斷通常用於分時（time slicing），精確度不是最重要； 而軟體中斷則常用於多核心間的訊息傳遞。 當需要高精度計時時，可以避免使用軟體中斷，或將高精度 timer 中斷經由其他中斷路徑傳送。 此外，軟體中斷被放在 `mip` 的最低四個位元，是為了方便軟體操作，能在單一 CSR 指令中以 5-bit 立即數設定  
:::

在 supervisor mode 中，`mip` 與 `mie` 暫存器的受限視圖（restricted views）分別對應為 `sip` 與 `sie` 暫存器。 當某個中斷被設定在 `mideleg` 中委託給 S-mode 時，它會在 `sip` 中變得可見，並且可以透過 `sie` 來控制是否啟用。 否則，對應的位元在 `sip` 與 `sie` 中都會是唯讀的 0

::: tip  
`mip`/`mie` 是 machine-mode 全域可見的中斷狀態，而 `sip`/`sie` 是 S-mode 的視角（受限版本）：

- `sip`：只顯示 S-mode 有權處理的中斷來源（依 `mideleg` 設定）
- `sie`：只允許 S-mode 啟用/關閉自己能處理的中斷

換句話說，這兩個暫存器的內容是從 `mip`/`mie`「根據 mideleg 過濾出來」的可見子集  
:::

### 3.1.10. Hardware Performance Monitor

M-mode 提供了一組基本的硬體效能監控功能。 `mcycle` CSR 用來記錄當前 hart 所在的處理器核心所執行過的時鐘週期數； `minstret` CSR 則記錄該 hart 已完成（retired）的指令數。 在所有 RV32 與 RV64 架構中，`mcycle` 與 `minstret` 都為 64 位元的精度

這些計數器暫存器在 hart 被重設後，其初始值為未定，但可以由軟體寫入特定值。 任何對 CSR 的寫入，會在該指令本身執行完成後才生效。 `mcycle` CSR 在某些情況下可能由同一個處理器核心上的多個 hart 共同持有，此時寫入 `mcycle` 的內容將對這些 hart 來說都是可見的。 平台應提供一種機制，來指出哪些 hart 共享同一個 `mcycle` CSR

::: tip
計數器一開機不保證初始為 0，軟體（如 OS）若要準確統計，應主動歸零。 若一個核心有多個 hart（例如 SMT 多執行緒核心），這些 hart 可能共用同一個 `mcycle`，這可能會造成統計交疊，所以平台（如 SBI 或 device tree）應提供是否共用的資訊給 OS（否則 OS 無法判斷計數器準確性）  
:::

硬體效能監控系統還包含額外的 29 個 64-bit 的事件計數器，分別為 `mhpmcounter3` 到 `mhpmcounter31`。 每個計數器都對應一個事件選擇器 CSR，稱為 `mhpmevent3` 到 `mhpmevent31`，這些都是 64-bit 的 WARL 暫存器，用來控制該計數器會對哪一種事件進行計數。 事件的意義由平台定義，但事件編號 0 被定義為「不計數」。 所有計數器原則上都應被實作，但實作可以透過讓該計數器與對應事件選擇器都固定為唯讀的 0 以符合合法的定義

![（Figure 17. Hardware performance monitor counters.）](image/h_monitor_counter.png)

`mhpmcounter` 系列是 WARL 類型的暫存器，在 RV32 與 RV64 架構下皆支援最多 64-bit 精度

當 XLEN 為 32 時，對 `mcycle`、`minstret`、`mhpmcountern` 與 `mhpmeventn` 這些 CSR 的讀取會傳回對應暫存器的第 31–0 位元，而寫入則僅會改變第 31–0 位元； 對應的高位元部分可以透過 `mcycleh`、`minstreth`、`mhpmcounternh` 與 `mhpmeventnh` CSR 來讀寫，這些會回傳對應暫存器的第 63–32 位元。 `mhpmeventnh` CSR 只有在實作了 Sscofpmf 擴充時才會提供

::: tip  
即使在 32-bit 系統下，這些暫存器的實際寬度仍是 64-bit，只是要透過分開存取（上下半部）。 這是 32-bit 架構下存取 64-bit CSR 的典型設計方式：

- `mcycle`、`mhpmcounterN`：低 32 bit（bits 0–31）
- `mcycleh`、`mhpmcounterNh`：高 32 bit（bits 32–63）

要注意操作順序：應先讀高位、再讀低位； 或先寫低位、再寫高位，以避免跨越溢位時讀取不一致。 這對統計精度非常關鍵，尤其是高頻率事件（如 clock cycles）極易溢位  
:::
