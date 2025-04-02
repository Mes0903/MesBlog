---
title: Paging （OSTEP Section 18~20）
date: 2025-04-02
tag: 
- OS
- OSTEP
category: OS
---

# Paging （Section 18~20）

## Paging: Introduction

OS 有兩種方法，來解決大多數空間管理問題。 第一種是將空間分割成「不同長度」的片段，就像虛擬記憶體管理中的 segmentation。 但這個解決方法存在固有的問題，將空間切成不同長度的片段以後，空間本身會碎片化（fragmented），隨著時間推移，記憶體的分配會變得困難

第二種方法是將空間分割成「固定長度」的片段。 在虛擬記憶體中，我們稱這種思想為 paging，可以追溯到一個早期的重要系統，Atlas [KE+62]。 paging 不會將一個 process 的位址空間分割成幾個不同長度的 segments（如 code、heap、stack segments），而是分割成固定大小的單元，每個單元稱為 page。 我們把物理記憶體看成是固定元素長度的陣列，這個元素有個名字叫 page frame，每個 page frame 包含一個 virtual page

::: info
接下來的主要問題是：
- 如何通過 page 來實現虛擬記憶體，從而避免 segmentation 的問題？  
- 基本技術是什麼？  
- 如何讓這些技術運行良好，並盡可能減少空間和時間開銷？  
:::

> 本文中如果使用 virtual page，則專指 VPN 對應到的邏輯上的 page。 如果是指物理上的 page 則會寫 page frame。 若只寫 page，則代表這是個 general 的概念，對於 virtual page 或 page frame 都通，此時想表達的只是一個固定大小的記憶體區段  
>  
> 另外，page table 的元素被稱為 PTE，這與 virtual page 及 page frame 是不同的東西，不要搞混了。 OS 會利用 virtual page 的 VPN 查找 page table，以得到 PTE，PTE 內部會記錄對應的 PFN（看 18.3 中 x86 的例子），之後再利用 PFN 得到 page frame

### 18.1 一個簡單例子

為了讓該方法看起來更清晰，我們用一個簡單例子來說明。 圖 18.1 展示了一個只有 64 bytes 的小位址空間，有 4 個 16 bytes 的 virtual page（virtual page 0、1、2、3）：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/OS/OSTEP/paging/image/18-1.png?raw=true">

</div>

- Figure 18.1：一個簡單的 64-byte 位址空間  
- Figure 18.2：64 bytes 的位址空間在 128 bytes 的物理記憶體中

真實的位址空間肯定大得多。 通常 32 bits 的系統有 4GB 的位址空間，更不用說現在還有 64 bits 的系統。 在本書中，我們會透過一些例子讓大家更容易理解

如圖 18.2 所示，物理記憶體是一組固定元素長度的陣列。 在這個例子中，有 8 個 page frame（由 128 bytes物理記憶體構成，很小）。 從圖中可以看出，virtual address space 的 virtual page 放在物理記憶體中的不同位置，你還可以發現 OS 自己也用了一些物理記憶體

可以看到，與我們以前的方法相比，paging 有許多優點。 最大的優點是靈活性，通過 paging，OS 能夠高效地抽象化 address space，不需理會 process 如何使用 address space，例如我們不用管 heap 和 stack 的增長方向，以及它們是如何被使用的

另一個優點是 paging 簡化了空閒（free）的空間管理。 例如，如果 OS 希望將 64 bytes 的小空間放到有 8 個 page frame 的物理記憶體中，那它只需要找到 4 個空閒 page frame 即可。 在 OS 的實作上，其可以設計一個保存了所有空閒 page 的空閒列表（free list），此時就只需從這個列表中拿出指定數量的空閒 page 即可

為了記錄每個 virtual page 放在物理記憶體中的位置，OS 通常會為每個 process 保存一個資料結構，稱為 page table。 page table 的主要作用是為每個 virtual page 保存其 address translation 的關係，從而讓我們知道每個 virtual page 在物理記憶體中的位置

在這個例子中（圖 18.2），OS 是這麼對應虛擬與物理的 page 的：

- virtual page 0 ⭢ page frame 3  
- virtual page 1 ⭢ page frame 7  
- virtual page 2 ⭢ page frame 5  
- virtual page 3 ⭢ page frame 2  
- page frame 1、4、6 目前是空閒的

要記住 page table 是每一個 process 都有的資料結構。 上例中如果還運行著另一個 process，OS 便會為它另外管理一個不同的 page table，它的 virtual page 映射到不同的 page frame（除了共享的 page 之外）

> 我們討論的大多數 page table 結構都是每一個 process 都有的資料結構，其中一個例外是 inverted page table

現在來看一個位址轉譯的例子。 假設擁有這個小位址空間（64 bytes）的 process 正在訪問記憶體：

```asm
movl <virtual address>, %eax
```

這邊我們關注從位址 `<virtual address>` 到暫存器 `eax` 的顯式載入（忽略 instruction fetch）。 為了轉譯該虛擬位址，我們必須先將它分成兩個部分：
- virtual page number，後面簡稱 VPN
- page 內的偏移量（offset）

對於這個例子，因為 process 的虛擬位址空間是 64 bytes 的，需要 6 個 bit 才能表達（$2^6 = 64$），因此虛擬位址的形式如下：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/OS/OSTEP/paging/image/VPN.png?raw=true">

</div>

在該圖中，`Va5` 是虛擬位址的最高位，`Va0` 是最低位。 因為我們知道 virtual page 的大小（16 bytes），所以可以進一步劃分虛擬位址：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/OS/OSTEP/paging/image/VPN-2.png?raw=true">

</div>

此時需要有方法讓我們能表達指定的 virtual page。 位址的前 2 位就是拿來做這件事的。 我們用 2 bits 來表示 VPN，其餘的 bit 用來表示該 page 內的哪個 bytes，在這個例子中其佔 4 bits，我們稱之為偏移量

當 process 生成虛擬位址時，OS 和硬體必須合作，將它轉譯為有意義的物理位址。 假設載入虛擬位址為 `21`：

```asm
movl 21, %eax
```

`21` 的二進制形式是 `010101`，看看它是如何分解成 VPN 與 offset 的：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/OS/OSTEP/paging/image/VPN-3.png?raw=true">

</div>

因此，虛擬位址 `21` 位於 virtual page `01` 內的第 5 個（`0101`）bytes 處

通過 VPN，我們現在可以查找 page table，找到 virtual page `1` 所在的 page frame。 在上面的 page table 中，physical frame number（PFN）是 7（二進制 `111`）。 因此，我們可以通過用 PFN 替換 VPN 來轉譯此虛擬位址，然後將載入發送給物理記憶體：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/OS/OSTEP/paging/image/18-3.png?raw=true">

（Figure 18.3：位址轉譯過程）

</div>

> PFN 有時也稱 physical page number，簡記為 PPN

請注意，偏移量保持不變，因為偏移量只是告訴我們 page 中的哪個 bytes 是我們想要的。 我們的最終物理位址是 `1110101`（十進制 117），正是我們希望載入指令（見圖 18.2）獲取資料的地方

有了這個基本概念，我們現在可以探討關於 paging 的一些基本問題，例如：

- 這些 page table 被存在哪裡？  
- page table 的內容是什麼？  
- 整個 table 有多大？  
- paging 是否會使系統變慢？

### 18.2 Page Table 存在哪裡

page table 可以變得非常大，比我們之前討論過的 small segment table 或 base/bound pair 要大得多。 想像一個典型的 32-bit 系統，其位址空間有 $2^{32}$ bytes，帶有 4KB 的 page

> 原文為了方便，會直接簡稱為 32-bit address space，這與前面 64 bytes address space 有點混淆，前者代表的是位址空間有 $2^{32}$ bytes，後者代表位址空間只有 64 bytes，雖然寫起來一模一樣，但意思差很多，讀的時候記得自己分辨一下

假設該系統的虛擬位址分成 20 位的 VPN 和 12 位的偏移量。 一個 20 位的 VPN 意味著有 $2^{20}$ 個 virtual page，因此 OS 必須為每個 process 管理 $2^{20}$ 個位址轉譯（大約一百萬）

> 有 $2^{20}$ 個 virtual page，每個 virtual page 的大小為 $2^{12}$ bytes，則整個位址空間有 $2^{20} \times 2^{12}$ bytes 這麼大，符合我們的假設

假設每個 page table 的元素（被稱為 page table entry，簡記為 PTE）需要 4 bytes，以保存物理位址轉譯和任何其他有用的東西。 則單個 page table 就會需要 4MB 記憶體，這超大

現在想象一下有 100 個 process 在運行：這代表 OS 需要花費 400MB 的記憶體，僅僅是為了做位址轉譯。 即使是現在，機器擁有 GB 級別的記憶體，這也是占了很大一部分，更不用提 64-bit 系統的 page table 了，又會再變更大

由於 page table 如此之大，我們沒有在 MMU 中利用任何特殊的硬體，來儲存當前正在運行的 process 的 page table，而是將每個 process 的 page table 儲存在記憶體中

圖 18.4 展示了 OS 記憶體中的 page table。 後面我們會看到，很多 OS 記憶體本身都可以虛擬化，因此 page table 可以儲存在 OS 的虛擬記憶體中（甚至可以交換到硬碟上）

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/OS/OSTEP/paging/image/18-4.png?raw=true">

(Figure 18.4：一個 Kernel物理記憶體內的 Page Table 的例子)

</div>

### 18.3 Page Table 內有什麼

page table 就是一種資料結構，用於將虛擬位址映射到物理位址（實際上是在操作 VPN 與 PFN）。 因此只要能達成目的，你其實可以使用任何你喜歡的資料結構來做 page table

而 page table 最簡單的形式稱為 linear page table，其就是一個陣列。 OS 通過 VPN 作為索引訪問該陣列，得到對應的 PTE，再利用它找到目標 PFN

現在我們先將假設使用這個簡單的線性結構。 後面我們會再利用更高級的資料結構來解決一些 paging 的問題

每個 PTE 內部有許多不同的 bit：

- 有效位（valid bit）  
  - 用於標記特定位址轉譯是否有效  
    - 例如，當一個 process 開始運行時，它的 code 和 heap 段在位址空間的一側，而 stack 段又在另一側。 此時中間所有未使用的空閒空間都會被標記為無效的（invalid），如果 process 嘗試訪問這些記憶體，就會引發 interrupt，這可能會導致該 process 被終止  
  - 因此，有效位對於支持稀疏位址空間至關重要  
  - 通過把位址空間中所有未使用的 virtual page 標記為無效的，我們就不再需要為這些 virtual page 分配物理記憶體，從而節省大量記憶體
- 保護位（protection bit）  
  - 用於標記 virtual page 是否可以被讀取、寫入或執行  
  - 同樣地，以這些位不允許的方式訪問 virtual page，會引發 interrupt
- 存在位（present bit）  
  - 表示該 virtual page 是在物理記憶體內，還是在硬碟上（即它已被換出，swapped out）  
  - swap 允許 OS 將很少使用的 page 移到硬碟，從而釋放物理記憶體 
  - 當我們研究如何將部分位址空間交換（swap）到硬碟，從而支持大於物理記憶體的位址空間時，我們將進一步理解這一機制
- 髒位（dirty bit）  
  - 用以標記 virtual page 被載入記憶體後是否被修改過
- 參考位（reference bit，也被稱為訪問位，accessed bit）  
  - 有時用於追蹤 virtual page 是否被訪問，也用於確定哪些 virtual page 很受歡迎，因此應該保留在記憶體中  
  - 這在 page replacement 時非常重要，我們將在隨後的章節中詳細研究這一主題

還有其他一些重要的部分，但現在我們先不做過多討論

圖 18.5 是一個來自 x86 架構的 PTE 範例：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/OS/OSTEP/paging/image/18-5.png?raw=true">

</div>

它包含
- 一個存在位（P）  
- 一個讀/寫位（R/W）  
  - 用於確定是否允許寫入該 virtual page  
- 一個 user/supervisor bit（U/S）  
  - 用於確定 user mode process 是否可以訪問該 virtual page  
- 一些如 PWT、PCD、PAT 和 G 的 bit  
  - 用於確定硬體快取如何為對應的 page frame 工作  
- 一個訪問位（A）  
- 一個髒位（D）  
- page frame number（PFN）本身

你可以透過閱讀 intel 的架構手冊，以得到更多有關 x86 paging 詳細信息，但它真的很難讀，應該說頁數超多，需要億點耐心

### 18.4 paging 很慢

我們已經知道記憶體中的 page table 可能太大了。 現在還有另一個現象，它們也會讓速度變慢。 以簡單的指令為例：

```asm
movl 21，%eax
```

同樣地，我們只看對虛擬位址 `21` 的顯式存取，不關心 instruction fetch

在這個例子中，我們假設由硬體執行位址轉譯。 要獲取所需資料，系統必須先將虛擬位址（`21`）轉譯為正確的物理位址（`117`）。 因此，在從位址 `117` 獲取資料之前，系統必須先從 process 的 page table 中找到對應的 PTE，執行轉譯得到 PFN，然後從物理記憶體中載入資料

為此，硬體必須知道當前 process 的 page table 的位置。 通常會有一個 page table 基址暫存器（page-table base register，簡記為 PTBR），內含 page table 起始位置的物理位址。 為了找到目標 PTE 的位置，硬體將執行以下功能：

```cpp
VPN = (VirtualAddress & VPN_MASK) >> SHIFT
PTEAddr = PageTableBaseRegister + (VPN * sizeof(PTE))
```

在我們的例子中，`VPN MASK` 被設為 `0x30`（十六進制 `30`，或二進制 `110000`），它從完整的虛擬位址中挑選出 `VPN` bit。 `SHIFT` 被設為 `4`（偏移量的位數），這樣我們就可以透過將 `VPN` bit 向右移動以得到正確的 VPN

例如，使用虛擬位址 `21`（`010101`），`VPN MASK` 將此值轉譯為 `010000`，`SHIFT` 將它變成 `01`，也就是第二個 virtual page（VPN 為 1），正是我們期望的值

因為 PTBR 內有 page table 的物理位址，當我們使用剛剛獲得的 `01` 作為 PTBR 指向的 page table（PTE 的陣列）的索引時，硬體就可以從記憶體中得到目標 PTE，並提取 PFN。 之後再將它與來自虛擬位址的偏移量接起來，就可以得到目標物理位址了

你可以想象 PFN 被 `SHIFT` 左移，然後與偏移量進行 or 運算，以形成最終位址，如下所示：

```cpp
offset = VirtualAddress & OFFSET_MASK
PhysAddr = (PFN << SHIFT) | offset

// Extract the VPN from the virtual address
VPN = (VirtualAddress & VPN_MASK) >> SHIFT

// Form the address of the page-table entry (PTE)
PTEAddr = PTBR + (VPN * sizeof(PTE))

// Fetch the PTE
PTE = AccessMemory(PTEAddr)

// Check if process can access the page
if (PTE.Valid == False)
  RaiseException(SEGMENTATION_FAULT)
else if (CanAccess(PTE.ProtectBits) == False)
  RaiseException(PROTECTION_FAULT)
else
  // Access is OK: form physical address and fetch it
  offset = VirtualAddress & OFFSET_MASK
  PhysAddr = (PTE.PFN << PFN_SHIFT) | offset
  Register = AccessMemory(PhysAddr)
```

> 原文中這段 code 好像是張圖，編號是 18.6

這些步驟做完後硬體就可以從記憶體中獲取所需的資料，並將其放入暫存器 `eax` 了。 至此 process 便成功從記憶體中載入了一個值

你可以發現，對於每個記憶體操作（無論是取指令，還是顯式載入/儲存），paging 都需要我們執行一個額外的記憶體操作，以從 page table 中獲取位址轉譯的關係。 而額外記憶體操作的開銷很大，在這種情況下，可能會使 process 減慢兩倍或更多

現在你應該可以看到，有兩個必須解決的實際問題。 如果不仔細設計硬體和軟體，page table 會導致系統運行速度過慢，並占用太多記憶體。 雖然 paging 看起來是一個很好的記憶體虛擬化的解決方案，但必須先克服這兩個關鍵問題

### 18.5 記憶體追蹤

我們現在通過一個簡單的記憶體訪問範例 `array.c`，來演示使用 paging 時產生的所有記憶體訪問：

```cpp
int array[1000];

...

for (i = 0; i < 1000; i++)
  array[i] = 0;
```

我們編譯 array.c 並使用以下命令運行它：

```shell
prompt> gcc -o array array.c -Wall -O
prompt> ./array
```

::: info
現代 OS 的記憶體管理子系統中最重要的資料結構之一就是 page table。 通常 page table 儲存虛擬 ⬌ 物理位址轉譯的關係（virtual-to-physical address translation），從而讓系統知道位址空間的每個 page 實際在物理記憶體中的哪個位置

由於每個位址空間都需要這種轉譯，因此一般來說，系統中每個 process 都有一個 page table

page table 的確切結構要麽由硬體（舊系統）決定，要麽由 OS（現代系統）更靈活地管理
:::

為了真正理解執行這段程式碼時，process 如何訪問記憶體，我們必須知道（或假設）一些東西

首先，我們必須 decompile 輸出的二進制文件（可以在 Linux 上使用 objdump 或在 Mac 上使用 otool），查看它使用什麽指令來在迴圈中初始化陣列

以下是輸出的組語：

```asm
0x1024 movl $0x0,(%edi,%eax,4)
0x1028 incl %eax
0x102c cmpl $0x03e8,%eax
0x1030 jne 0x1024
```

如果懂一點 x86，上例還是很好理解的。 第一條指令將 `$0x0` 複製到陣列的虛擬記憶體位址，這個位址是通過將 `%edi` 的值加上 `%eax` 乘以 4 來計算的。 因此可以輕鬆得知 `%edi` 保存陣列的基址，而 `%eax` 保存陣列索引

> 乘以 4 是因為這是一個整數陣列，每個元素的大小為 4 個 bytes

第二條指令增加保存在 `%eax` 中的陣列索引。 第三條指令將該暫存器的內容與十六進制值 `0x03e8`（十進制 `1000`）進行比較。 如果比較結果顯示兩個值不相等（`jne` 測試），第四條指令會跳回到循環的頂部

為了理解這個指令序列（在虛擬層和物理層）所訪問的記憶體，我們必須假設虛擬記憶體中程式碼片段和陣列的位置，以及 page table 的內容和位置。 對於這個例子，假設一個大小為 64KB 的 virtual address space，page 大小為 1KB

我們現在需要知道 page table 的內容，以及它在物理記憶體中的位置。 假設有一個 linear page table，位於物理位址 1KB（`1024`）。 至於其內容，我們只關心於這個例子中映射的幾個 virtual page

由於 page 大小為 1KB，虛擬位址 `1024` 位於 virtual address space 的第二 page（VPN = 1，VPN 從 0 開始）。 例子內的陣列大小為 4000 bytes（1000 個整數），假設它位於虛擬位址 `40000` 到 `44000`（不包括最後一個 bytes）。 其 virtual page 的十進制範圍是 `VPN = 39` 至 `VPN = 42`

針對這個例子，我們假設以下虛擬到物理的映射：

- VPN 39 → PFN 7
- VPN 40 → PFN 8
- VPN 41 → PFN 9
- VPN 42 → PFN 10

現在可以開始追蹤 process 的記憶體存取了。 程式在執行時，每一次指令擷取（instruction fetch）都會產生兩次記憶體存取：一次存取 page table（以查詢指令所在的 page frame），一次存取指令本身，將它擷取到 CPU 以便處理

此外，程式中還有一個明確的記憶體存取：`mov` 指令。 這會另外先多訪問一次 page table，以將陣列的虛擬位址轉譯為正確的物理位址，再來才是對陣列本身進行存取

圖 18.7 展示了前 5 次循環的過程：

<div class = "center-column">

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/OS/OSTEP/paging/image/18-7.png?raw=true">

（Figure 18.7：虛擬與物理記憶體的追蹤）

</div>

- 最下方的圖表用黑色方塊顯示指令記憶體的存取情形。 y 軸表示記憶體位址，其中左側是虛擬位址，右側是物理位址
- 中間的圖表則用深灰色方塊表示對陣列的存取。 一樣虛擬位址在左側，物理位址在右側
- 最上方的圖表用淺灰色方塊表示對 page table 的記憶體存取。 僅顯示物理位址，因為本例中的頁表存在於物理記憶體中
- 整個圖表的 x 軸代表前五次迴圈迭代中所有的記憶體存取順序
- 每次迴圈總共有 10 次記憶體存取，包含四次指令擷取（instruction fetch）、一次對記憶體的明確寫入，以及五次 page table 的存取，用來轉譯這四次擷取和一次寫入的虛擬位址

> 這裡假設每條指令的大小都是 4 bytes。 實際上，x86 指令是可變大小的

### 18.6 小結

我們已經介紹了 paging 的概念，作為記憶體虛擬化挑戰的解決方案，相比於先前的方法（segmentation）有許多優點

- 它不會導致外部碎片，因為 paging 本身的設計就是將記憶體劃分為固定大小的單位
- 它具有高度彈性，允許 virtual address space 的稀疏使用
- 然而，如果隨便地實作 paging 機制，會導致系統變慢（需要額外的記憶體存取來讀取 page table），也會造成記憶體浪費（記憶體被 page table 佔滿，而不是用來儲存實際的應用資料）

因此，我們需要更深入地思考，設計出一套不只是可行，而且效率良好的分頁系統。 接下來的兩章會帶我們了解該怎麼做到這一點

### 18 章參考資料

- [KE+62] “One-level Storage System” by T. Kilburn, D.B.G. Edwards, M.J. Lanigan, F.H. Sumner. IRE Trans. EC-11, 2, 1962. Reprinted in Bell and Newell, “Computer Structures: Readings and Examples”. McGraw-Hill, New York, 1971  
  - Atlas 電腦率先提出了將記憶體劃分為固定大小 page 的概念，某種程度上可視為現代電腦系統中記憶體管理技術的早期雛形

- [I09] “Intel 64 and IA-32 Architectures Software Developer’s Manuals” Intel, 2009. Available: http://www.intel.com/products/processor/manuals  
  - 特別值得留意的是 「Volume 3A: System Programming Guide Part 1」 與 「Volume 3B: System Programming Guide Part 2」

- [L78] “The Manchester Mark I and Atlas: A Historical Perspective” by S. H. Lavington. Communications of the ACM, Volume 21:1, January 1978  
  - 這篇文章是對一些重要電腦系統發展歷史的精彩回顧。 我們在美國有時會忘記，其實這些嶄新的觀念中，有許多是來自海外的貢獻
