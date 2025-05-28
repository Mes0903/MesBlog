---
title: OSTEP 21：Swapping Mechanisms
date: 2025-04-06
tag: 
- OS
- OSTEP
category: OS
---

# OSTEP 21：Swapping Mechanisms

到目前為止，我們都假設正在執行的 process 的 address space 都能放進記憶體裡。 現在我們要看更 general 的情況，希望能支援多個同時執行的大型 address space

為了支援大型的 address space，OS 需要一個地方來暫存那些目前需求不高的 address space 的內容，這個地方的容量通常會比 memory 大，也因此通常較慢（如果它比較快，那就可以直接拿來當記憶體用了）

為了達到這個目的，我們需要在 memory hierarchy 中再多一層抽象化，在現代系統中，這個角色通常由硬碟來擔任，至此，我們的 memory hierarchy 中，較慢但容量很大的硬碟位於最底層，記憶體則在其之上

於是我們來到了問題的關鍵：

::: info  
關鍵：如何超越 physical memory

OS 要如何利用一個容量較大但速度較慢的裝置，來提供一個巨大的 virtual address space，且不被 process 察覺到？  
:::

為了方便與易用性，我們希望能支援一個 process 擁有很大的 address space，有了大的 address space，你就不用擔心程式的資料結構是否有足夠的空間放進記憶體裡，你只需要自然地寫程式，按需求配置記憶體即可

這就是 OS 提供的抽象化，讓你可以不用管底層的記憶體邏輯便可很簡單的配置記憶體。 相對來說，舊系統使用的是 memory overlay，這需要你手動將程式碼或資料的部分內容搬進搬出記憶體 [D97]，在呼叫某個 function 或存取某些資料之前，你得先手動安排那些程式碼或資料要在記憶體裡的位置

在實務上我們會有 multiprogramming（同時執行多個程式）的需求，而其強烈需要系統具備換出某些 page 的能力，因為早期機器根本無法同時容納所有 process 所需的所有 page。 因此，multiprogramming 與易用性的結合讓我們傾向於支援使用超出實體記憶體容量的記憶體。 這是所有現代 virtual memory 系統都會做的事

為了實作這個功能，我們引入了 swap space，它不只限於單一 process，swap space 的加入讓 OS 能夠為多個同時執行的 process 提供大型 virtual memory，接下來就來細看它是怎麼做的

::: info  
補充：儲存技術

我們後面的章節會更深入探討 I/O 裝置的實際運作方式，這個較慢的裝置不一定要是硬碟，也可以是像 Flash 的 SSD 這類比較現代的設備。 目前我們只先假設有一個容量大但相對較慢的裝置，可以拿來幫助我們構築一個非常大的 virtual memory 的錯覺，甚至大到超過 physical memory 本身  
:::

## 21.1 Swap Space

第一件我們需要做的事，是在硬碟上保留一塊空間，來暫存那些目前需求不高的 page。 在作業系統中，我們通常把這種空間稱作 swap space，因為我們會把 page 從記憶體中 swap 出來放到這裡，也會從這裡將 page swap 進記憶體裡

因此，我們就假設 OS 能夠以 page 為單位，從 swap space 中讀取與寫入。 為了做到這件事，OS 需要能夠記住某個 page 在硬碟上的位址

swap space 的大小很重要，因為它最終決定了系統在某一時間點中最多能使用多少個 page。 為了簡化起見，我們先假設它非常大

看個例子：

<div class = "center-column">

<img src = "https://raw.githubusercontent.com/Mes0903/MesBlog/refs/heads/vuepress-theme-hope/src/OS/OSTEP/swapping/21/image/21-1.png">

</div>

在這個例子中（Figure 21.1），你可以看到一個只有 4 個 page 大小的 physical memory ，另外還有一個 8 個 page 的 swap space。 在這個例子裡，三個 process（Proc 0、Proc 1 和 Proc 2）正在共享 physical memory；然而，它們每個 process 只有一部分有效的 page 在記憶體裡，其餘的則在硬碟的 swap space 中

第四個 process（Proc 3）所有的 page 都被 swap 出去了，可見它目前沒有在執行。 另外，有一塊 swap 空間還是空的。 透過這個例子，你能看出使用 swap space 可以讓系統假裝 memory 比實際上大得多

要注意的是，swap space 並不是硬碟上唯一會用來傳輸資料的地方。 舉例來說，假設你正在執行一個程式的 binary，這些 binary 的 code page 最初是存在硬碟上的，當程式執行時，它們會被載入到記憶體裡，此時如果系統需要釋放 physical memory 來給其他用途，它就可以放心地回收這些 code page 所佔的記憶體，因為它知道之後可以再從檔案系統裡的 binary 檔案中把它們載入回來

## 21.2 The Present Bit

現在我們在硬碟上有了一些空間，我們需要在系統的更高層加入一些機制，來把 page swap 到硬碟上或從硬碟 swap 回來。 為了簡單起見，我們假設這個系統是用硬體管理的 TLB

先回顧一下在存取記憶體時會發生什麼事，執行中的 process 會產生對 virtual memory 的存取（可能是抓取指令，或存取資料），這時硬體會先從 virtual address 中取出 VPN，然後檢查 TLB 看有沒有命中，如果命中，就直接產生對應的 physical address 並從記憶體取出

如果 TLB 找不到對應的 VPN（TLB miss），硬體會去記憶體中找 page table（透過 PTBR），並用 VPN 當索引查詢對應的 PTE。 如果該 page 是有效的、而且還在 physical memory 中，硬體就會從 PTE 中取出 PFN，寫入 TLB，然後重新執行原本的指令，這次就會 TLB hit

但如果我們希望能把 page swap 到硬碟上，就還需要更多的機制。 具體來說，PTE 中需要一個額外資訊來讓硬體（或在軟體管理 TLB 的系統中是 OS）知道該 page 在不在 physical memory 中這個資訊叫做 present bit

如果 present bit 是 1，表示這個 page 現在在 physical memory 中，接下來的流程就跟剛才說的一樣；如果它是 0，表示這個 page 不在記憶體裡，而是在硬碟的某個地方。 此時我們透過老方法 — exception 來處理，當你存取了一個不在 physical memory 裡的 page，就會觸發 page fault

一旦發生 page fault，OS 中一段特定的程式碼 — page-fault handler，便會被找來處理這次的 page fault，接下來我們會描述它的工作

::: info  
補充：Swapping 的術語與其他事情

在 virtual memory 系統中，術語可能有點令人困惑，而且在不同的機器與 OS 中不太一樣。 舉例來說，page fault 這個詞在比較廣的意義上，可能指任何查表造成的錯誤：可以是我們目前討論的這種 page-not-present fault，也可能是非法記憶體存取

事實上，把一個明明是合法的存取（對某個已映射到 process virtual address space 的 page，只是那頁當下不在記憶體中）稱作 "fault" 本身就很奇怪；其實它應該叫做 page miss。 但通常人們說某個程式在 "page faulting"，意思是它正在存取那些 OS 已經 swap 出去的 virtual address space 的部分

我們猜這種行為會被叫作 "fault"，可能是因為 OS 用來處理它的機制。 在發生某些異常時，也就是硬體不知道該怎麼辦的時候，硬體會把控制權交給 OS，期望 OS 能讓情況變好。 在這個例子中，某個 process 想要存取的 page 不在記憶體中，硬體唯一能做的事就是丟出一個 exception，然後讓 OS 接手處理。 因為這跟 process 做了什麼非法行為時的處理方式一模一樣，所以我們用 "fault" 這個詞其實也不奇怪  
:::

## 21.3 The Page Fault

還記得在 TLB miss 的情況下，我們有兩種類型的系統：hardware-managed TLB（由硬體去 page table 裡找轉譯結果）與 software-managed TLB（由 OS 去找）。 但在這兩種系統裡，如果某個 page 不在記憶體中，實作上卻幾乎都是由 OS 來處理 page fault

如果某個 page 不在記憶體裡，且已經被 swap 到硬碟上，OS 就需要把這個 page swap 回記憶體，以處理這次的 page fault。 於是問題來了 — OS 要怎麼知道要去哪裡找這個 page？ 在許多系統中，PTE 是個好選擇，OS 會把原本 PTE 裡用來存 PFN 的那些 bit 拿去存放硬碟位址。 當某個 page 發生 page fault 時，OS 就可以從 PTE 裡找到它的位址，然後送出 disk I/O 請求，把該 page 載入回記憶體

當 disk I/O 完成後，OS 會更新 page table，把該 page 標記為 present，並更新 PTE 的 PFN 欄位，記下這個剛載進來的 page 在記憶體中的位置，然後重新執行原本的指令。 這次可能會觸發一次 TLB miss，並於處理時把轉譯結果更新到 TLB（也可以選擇在處理 page fault 時就先更新 TLB，以省略這步）。 最後一次重新執行時，就會在 TLB 裡找到對應轉譯，然後從記憶體中的實體位址取出目標資料或指令

在 I/O 執行的期間，該 process 會處於 blocked 狀態。 因此，OS 可以在 page fault 被處理的期間去執行其他已 ready 的 process。 因為 I/O 成本很高，這種讓一個 process 的 page fault I/O 與另一個 process 的執行交錯進行的方式，是 multiprogramming 系統有效運用硬體資源的又一種方法

::: info  
補充：為什麼不是硬體來處理 page fault？

我們從 TLB 的經驗中知道，硬體設計者通常不太願意把事情交給 OS 處理，但為什麼他們信任 OS 處理 page fault？ 這裡有幾個主要原因。 第一，page fault 到 disk 很慢，而 OS 要花很多時間處理 fault，加上 disk 本身的操作也已經很慢了，所以這些額外的軟體成本基本上可以忽略

第二，為了讓硬體能夠處理 page fault，它必須了解 swap space、知道怎麼發出 disk I/O、以及其他很多目前硬體並不了解的細節。 因此，基於效能與簡化兩個理由，OS 來處理 page fault，是最合理的選擇  
:::

## 21.4 What If Memory Is Full?

在上面的流程中，你可能注意到前面我們都假設記憶體中有很多空間可以拿來放從 swap space 載進來的 page。 但現實中可能不是這樣，記憶體可能已經滿了（或快滿了）。 此時 OS 可能會想先把一或多個 page swap 出去，以騰出空間給即將載進來的新 page。 而挑選要被踢出去的 page 的這個動作，被稱為 page-replacement policy

事實上，為了設計一個好的 page-replacement policy，研究者已經投入了很多心力，因為選錯 page 踢出去，可能會大大影響程式效能，以目前的技術來說，這可能會變慢一萬倍甚至十萬倍。 因此，這項策略是我們應該仔細研究的主題，這也正是我們下一章要做的事。 目前只要知道有這樣一個策略，它是建立在我們這章所描述的機制之上就好

## 21.5 Page Fault Control Flow

有了這些知識，我們現在可以大致描繪出記憶體存取時的完整控制流程了。 換句話說，當有人問你「當一個程式從記憶體抓資料時會發生什麼事？」你應該能對所有不同的可能情況有一個很清楚的概念。 可以參考 Figure 21.2 和 21.3 來看控制流程的細節；第一張圖顯示硬體在轉譯期間的動作，第二張圖則顯示 OS 在 page fault 發生時會做什麼

**Figure 21.2: Page-Fault Control Flow Algorithm (Hardware)：**

```cpp
VPN = (VirtualAddress & VPN_MASK) >> SHIFT
(Success, TlbEntry) = TLB_Lookup(VPN)

if (Success == True) // TLB Hit
  if (CanAccess(TlbEntry.ProtectBits) == True)
    Offset = VirtualAddress & OFFSET_MASK
    PhysAddr = (TlbEntry.PFN << SHIFT) | Offset
    Register = AccessMemory(PhysAddr)
  else
    RaiseException(PROTECTION_FAULT)
else // TLB Miss
  PTEAddr = PTBR + (VPN * sizeof(PTE))
  PTE = AccessMemory(PTEAddr)
  if (PTE.Valid == False)
    RaiseException(SEGMENTATION_FAULT)
  else
    if (CanAccess(PTE.ProtectBits) == False)
      RaiseException(PROTECTION_FAULT)
    else if (PTE.Present == True)
      // assuming hardware-managed TLB
      TLB_Insert(VPN, PTE.PFN, PTE.ProtectBits)
      RetryInstruction()
    else if (PTE.Present == False)
      RaiseException(PAGE_FAULT)
```

從 Figure 21.2 的硬體控制流程圖中你可以看到，當發生 TLB miss 時，有三種重要的情況需要理解。 第一種情況是該 page 同時是 present 且 valid（圖中第 19–22 行），這種情況下，TLB miss handler 可以直接從 PTE 拿到 PFN，重新執行指令（這次會是 TLB hit），然後就像前面說過很多次那樣繼續執行

第二種情況（圖中第 23–24 行），需要執行 page fault handler，雖然這個 page 是合法的（因為它 valid），但它現在不在 physical memory 裡。 最後一種情況，是你存取了一個 invalid 的 page，這可能是因為程式有 bug（圖中第 14–15 行），這種情況下，PTE 裡的其他 bit 都不重要了，硬體會捕捉到這個非法存取，然後由 OS 的 trap handler 接手，通常會終止這個錯誤的 process

**Figure 21.3: Page-Fault Control Flow Algorithm (Software)：**

```cpp
PFN = FindFreePhysicalPage()
if (PFN == -1) // no free page found
  PFN = EvictPage() // replacement algorithm

DiskRead(PTE.DiskAddr, PFN) // sleep (wait for I/O)
PTE.present = True // update page table:
PTE.PFN = PFN // (present/translation)
RetryInstruction() // retry instruction
```

從 Figure 21.3 的軟體控制流程圖中，我們可以看到 OS 大致上需要做哪些事來處理一個 page fault。 首先，OS 必須找一個 physical frame 來放即將被載進來的 page，如果沒有空的 page，我們就得等 page-replacement 演算法跑完，把某些 page 踢出記憶體，才能騰出空間

當找到一個 physical frame 後，handler 會送出 I/O 請求，從 swap space 中讀取 page。 最後，當這個緩慢的操作完成後，OS 會更新 page table，然後重新執行原本的指令。 這會先造成一次 TLB miss，接著再 retry 一次，第二次就會 TLB hit 了，這時硬體就可以從記憶體中存取到想要的東西

## 21.6 When Replacements Really Occur

到目前為止，我們描述 replacement 發生的方式是假設 OS 會等到記憶體完全滿了，才會去替換（evict）某個 page，來空出空間給其他 page。 你可以想像，這其實有點不切實際，OS 有很多理由會希望能更積極地維持一小部分記憶體是空的

為了維持一小部分的空記憶體，大多數作業系統會設置某種類型的 high watermark（HW）與 low watermark（LW），來幫助決定什麼時候該開始把 page 從記憶體中 evict

它的運作方式如下：當 OS 注意到可用的 page 少於 LW 時，一個負責釋放記憶體的背景執行緒會啟動。 這個執行緒會不斷 evict page，直到系統中有至少 HW 個 page 是可用的。 這個背景執行緒有時候會被叫做 swap daemon 或 page daemon，然後它就會進入睡眠狀態，讓出了一些記憶體供其他 process 與 OS 使用

對於一次執行多個 replacement，我們還能做一些效能上的最佳化。 例如許多系統會將一批 page 聚集起來一起寫入 swap partition，這樣能提升 disk 的效率 [LL82]。 我們稍後在討論 disk 時也會看到，這種 clustering 可以減少硬碟的 seek 與 rotation 所需的時間，因此效能會有明顯的提升

為了讓這個背景 paging 的執行緒運作，我們需要稍微修改一下 Figure 21.3 裡的控制流程，演算法不再是直接做 replacement，而是先檢查有沒有 free page。 如果沒有，就會通知背景 paging 執行緒說需要釋放一些 page，等該執行緒釋放了一些 page 之後，原本的執行緒會被喚醒，接著它就能把想要的 page 載入，繼續它原本的工作

::: info  
TIP: DO WORK IN THE BACKGROUND

當你有一些工作要做時，把它放到背景中去做，常常能提升效率，並讓操作可以被分批處理。 作業系統經常會在背景中做事，例如很多系統會先把檔案寫入動作暫存在記憶體中，之後才真的把資料寫進硬碟。 這樣做有許多潛在的好處：提升硬碟效率，因為硬碟現在能一次接收很多寫入請求，方便排程

另外還能提升寫入延遲表現，應用程式會覺得寫入動作很快就完成了，這有機會減少實際工作量，因為檔案可能根本不會被寫入硬碟（例如檔案又被刪除了）；最後就是能更有效地使用閒置時間，因為背景工作可以趁系統閒置時執行，進而提升硬體的使用率 [G+95]  
:::

## 21.7 Summary

在這章短短的內容中，我們介紹了如何存取系統中實際不存在的更多記憶體。 為了做到這件事，page-table 結構需要變得更複雜，需要多一個 present bit，來告訴我們該 page 是否在記憶體中

當 page 不在記憶體中時，作業系統的 page-fault handler 就會跑起來來處理這次的 page fault，並安排將所需的 page 從硬碟搬進記憶體，有時候還需要先把記憶體中的某些 page 替換掉，來為這些即將被 swap 進來的 page 騰出空間

請記得一件很重要的事，這些動作對 process 來說都是透明的。 從 process 的角度來看，它只是單純在存取自己的 private、連續的 virtual memory。 但在底層，這些 page 實際上是被放在 physical memory 中任意（不連續）的位置，有時候甚至根本不在記憶體裡，而需要從硬碟中載回來

我們希望大多數情況下 memory access 都是很快的，但有些情況下，光是一個 memory access，可能會需要好幾次硬碟操作，甚至在最糟的情況下，一條簡單的指令也可能要好幾毫秒才能完成

## References

- [CS94] “Take Our Word For It” by F. Corbato, R. Steinberg. www.takeourword.com/TOW146（第 4 頁）。 Richard Steinberg 寫道：「有人問我 daemon 這個詞在電腦領域的起源。 根據我的研究，最早使用這個詞的是你們團隊在 1963 年於 Project MAC 使用 IBM 7094 時。 」Corbato 教授回應：「我們使用 daemon 這個詞是受到物理與熱力學中的 Maxwell's daemon 啟發。 Maxwell's daemon 是一個想像中的代理者，會在背景中幫忙分類不同速度的分子。 我們就天馬行空地把 daemon 這個詞拿來形容那些在背景中不知疲倦地執行系統瑣事的背景程序」

- [D97] “Before Memory Was Virtual” by Peter Denning. 收錄於《In the Beginning: Recollections of Software Pioneers》，Wiley，1997 年 11 月出版。 這是 virtual memory 與 working set 概念創始人之一 Peter Denning 所寫的精彩歷史回顧文章

- [G+95] “Idleness is not sloth” by Richard Golding、Peter Bosch、Carl Staelin、Tim Sullivan、John Wilkes。 發表於 USENIX ATC ’95，地點為路易斯安那州紐奧良。 這篇文章輕鬆有趣，講述如何更有效地利用系統的閒置時間，裡面有很多實用範例

- [LL82] “Virtual Memory Management in the VAX/VMS Operating System” by Hank Levy、P. Lipman。 發表於 IEEE Computer，Vol. 15, No. 3，1982 年 3 月。 雖然這不是最早使用 page clustering 的文獻，但對這個機制的運作提供了清楚又簡單的解釋。 我們經常引用這篇論文
