---
title: 有關翻譯的小心得
date: 2025-07-29
tag: essay
category: essay
---

# 有關翻譯的小心得

![（鹽寶的會員好像要關了，紀錄一下，可惜沒滿 4 年）](./image/image.png)

前陣子由於 jserv 老師那邊要我協助做 code review（結果過了一個半月我還沒開始==），因此開始閱讀 [linmo](https://github.com/sysprog21/linmo) 的 codebase，但 pull 下來後發現我對 RISC-V 的 ISA 還不夠熟，離上次刻 OS 也有點久遠了，所以在閱讀 codebase 前想先回去閱讀一下文件和教材

由於之前正在準備 [semu](https://github.com/sysprog21/semu) SMP 相關的議題，所以有先閱讀過 [S-mode 的 ISA](https://mes0903.github.io/risc-v/Supervisor-Level-ISA/)，但當時閱讀發現自己對於 M-mode ISA 的掌握也是東漏西漏的，所以這次就決定先把 M-mode ISA 讀一下。 而由於我的腦袋實在不太好使，只是讀過去的話往往當天就會忘掉了，加上 RISC-V 的 ISA 裡面大大小小的規則加起來其實也不少，所以就還是寫了[翻譯與筆記](https://mes0903.github.io/risc-v/Machine-Level-ISA/)

大概花了三周才把他寫完，但寫完後發現自己不懂的東西好像更多了，所以就打算先把 linmo 上的 References 讀一下，順便再把之前想看的 [xv6-riscv-book](https://github.com/mit-pdos/xv6-riscv-book) 讀一下。 另外之前還有其他要翻的東西，像是要跟 karnage 寫 [vulkan tutorial](https://github.com/cpp-gamedev/learn-vulkan)，最近他那邊完工了剛好換我翻譯； 或是因為讀書會要做開源 EVB 所以想讀一下 LDD3 和 lkmpg 之類的

總之最近突然間翻了好多東西，剛好來把一些我會注意到的東西記錄下來，寫一下心得，還有一些心路歷程。 約莫在前年年初（2023）的時期，那時候我還需要以人工翻譯為主，遇到一些翻不好、不順暢的段落時才會以 GPT 輔助，當時曾試過以 GPT 為主的翻譯模式，但結果總差強人意，品質不太好

但到了大概去年年末（2024）的時候？ 我發現 chatgpt 4o 的翻譯品質慢慢起來了，而且好像一直在進步（純體感XD），當時還有些不穩，但已經讓我能夠用以 GPT 為主的模式來做翻譯了，此時它翻出來的句子大概還有 40% 左右會需要我人工做修改、重翻，這其中的問題主要就是「翻錯」與「語句不順」這兩點

但一直到了今年年中（2025），我發現 chatgpt 4o 的翻出來的句子，已經可以使我大概只需要修改 10% 左右了，而且這大部分都是只有針對語句不順的地方做小修改，極少會出現翻錯的情況了，只能說科技真的進步很快啊，要是我大二有這東西搞不好我高微就不會修地那麼辛苦了XD

目前我翻譯的流程主要就是

1. 複製原文：
    一次會以大概 5 段為主，一段大概 3 行。 據我不精確地估計，一行大概有 100 個英文字母，因此每次複製的原文大概會落在 1500 個字母左右
2. 貼給 chatGPT（4o）：
    我個人覺得 4o 的翻譯品質比 o3 還好，最明顯的差別在於語句的順暢程度，o3 翻出來的語句很容易唸起來拗口，而且翻譯的精準度體感比較低，例如這段原文（出自 RISC-V M-mode ISA）：

    > NAPOT ranges make use of the low-order bits of the associated address register to encode the size of the range, as shown in Table 19.

    o3 會翻譯為：

    > 在 NAPOT 模式下，範圍大小透過對應 `pmpaddr` 的低位元編碼，詳見表 19

    而 4o 會翻譯為：

    > NAPOT 區段會利用對應位址暫存器的低位元來編碼該區段的大小，如表 19 所示

    你會發現原文並沒提到「`pmpaddr`」，原文說的是「associated address register」，雖然從上下文來說它的確就是「`pmpaddr`」這個暫存器，但對我來說這是個很嚴重的錯誤，因為以翻譯來說我個人會希望翻譯要能精確地表達原文的意思，至於這類衍生的結論我則傾向用一個額外的 block 來補充

    這部分見仁見智，每個人都有自己喜歡的風格，但除此之外我個人認為 4o 的語句順暢度也比 o3 好，翻譯的速度還更快，使用的次數也有絕對的優勢，所以嘗試了許久後我還是使用 4o 來翻譯。 至於其他的 LLM 我則覺得在翻譯這塊都沒有 chatgpt 來的好，只有在 chatgpt 這邊一直得不到我滿意的翻譯時我才會以該段落為主地去嘗試其他 LLM
3. 校稿：
    我閱讀英文的速度並不快，所以大部分的情況下我會以直接閱讀譯文為主，在發現有奇怪的地方時才回頭閱讀原文。 這在以前（2023、2024）是做不到的事，如果前面所說，當時翻譯錯誤的問題還比較多，但據我觀察這段時間（翻了大概兩本書）它極少出現錯誤，就算出現了你一眼也能看出來，這也是現在能以 GPT 為主來翻譯的主要原因

    但這也牽涉到你對這個領域的熟悉度，對於我較不熟悉的領域，例如當時在翻 RISC-V M-mode ISA 時，我常常需要會去讀原文才能確定它講的是對的。 對於這件事我還有另一個習慣，就是我會讓 GPT 自己加一段對該段翻譯的解釋，具體來說我的 prompt 如下：

    > 逐段翻譯，並逐段解釋。 不要超譯，但也不要直譯，然後不要省略翻譯，不要原文中有出現的句子然後你沒翻到，請忠實於原文進行翻譯，但請潤飾語句使其通順，可以適當的加些輔助詞，但不要曲解原文的意思，原文沒提到的資訊不要寫在翻譯處，而是寫在解釋處

    而這會產生出這樣的效果，底下為 chatgpt 的回復原文（英文段落出自 RISC-V M-mode ISA）：

    ```
    第一段原文：

    > Coherence is straightforward to provide for a shared memory region that is not cached by any agent. The PMA for such a region would simply indicate it should not be cached in a private or shared cache.

    中文翻譯：

    對於沒有被任何 agent 快取的共享記憶體區域，一致性的實現非常簡單。這類區域的 PMA（物理記憶體屬性）只需指出：該區域不應被快取到任何私有或共享快取中

    詳細解釋：

    - 這是最簡單的一致性保證策略：既然大家都不快取這個區域，那麼所有讀寫都會直接走主記憶體，不會發生快取副本不一致的情況
    - 適合例如：
      - MMIO（記憶體對映輸出入）區域
      - 零時性共享資料區
    - 在 PMA 中設成 non-cacheable 即可保證這樣的屬性
    ```

    雖然不確定這能不能減少 GPT 翻譯上的錯誤，但我很確定這能幫助你進一步檢查出翻譯上的錯誤，透過閱讀它的解釋，比對原文，你能夠更快速的抓到幻覺、翻譯錯誤、漏翻等問題

    另外因為我通常都是邊學習邊做翻譯，因此這也是我學習的主要一個方式，在遇到我不確定的問題時，通常會再針對那個部分「請它找文獻」並解釋，然後一樣根據它找到的來源去大概判斷它講的有沒有問題，或直接去閱讀文獻來源。 這類來源通常會是論文、規格書、一般的 Blog 文章、stackoverflow 的回答等，此時如果發現文獻來源不太可靠，我會叫它重找

    透過這樣閱讀與翻譯第一手資訊，配上 GPT 的翻譯與它找到的文獻來源，我覺得學習效果比以前 GPT 還沒那麼方便的時期好很多
4. 排版（formatting）：
    由於我寫翻譯基本上都是為了給自己閱讀，所以通常 Blog 上的文章都是以我個人的閱讀習慣來做排版。 原則上會遵從[中文排版指北](https://github.com/sparanoid/chinese-copywriting-guidelines)，但不會完全遵守（除非是在翻一些官方的文件），像是我個人習慣句號「。」的後面要有一個空格，還有每個段落的後面我不習慣有句號等

## 一些小小的寫文/翻譯技巧

### 主體與目標要明確

再來是一些翻譯、寫文章的心得，其實你上網查一些教你怎麼寫 SEO-friendly 文章的教學，它都會提到一些技巧，但除了那些技巧，我覺得翻譯這部分有個很大的問題是中文的文法比較自由，這會導致你把原文轉換成中文時，如果直接套用原文的文法，往往會覺得「怪怪的」。 我沒有修過語言學（linguistics），但以前有稍微讀過 Programming Language 的理論，而語言學似乎也對自然語言有類似的「分類」行為，因此我認為對於這類針對自然語言有「怪怪的」的現象，語言學應該能夠提出一些解釋？

但就算不懂語言學，在翻譯的過程中，對於消除這種「怪怪的」的感覺的方法，我認為可以簡單濃縮為一句話：

> 主體與目標要明確

更準確來說，你的每句話要能夠表達出：

> 「誰」在「什麼前提」下，「做什麼事」會有「什麼結果」

這在寫數學證明時是一個很基本的準則，現在想想也許是數學系的經歷才讓我意識到這件事

對於這個準則，其基準也會被你所擁有的背景知識影響，因為當你的背景知識越足夠，你越容易聽懂對方在說什麼，就算對方講了一連串沒有主詞的句子，你也能夠很輕鬆（甚至無意識）地在腦中自動把那些主詞補上，進而知道對方在表達什麼。 但如果讀者的背景知識不夠，他就沒有這個「腦補」的能力，也因此會看不懂你的句子

<span class = "yellow">但也因如此，這部分也是見仁見智，我覺得順的語句你不一定覺得順</span>，因此底下所有都僅供參考，或說你可能有不同的解法，但可以聽聽我意識到的問題

另外如前面所述，中文的文法比較自由，這也會加劇這個問題，如上方這句：

> 但如果讀者的背景知識不夠，他就沒有這個「腦補」的能力，也因此會看不懂你的句子

第二句的「他」其實常常會在我們在寫文章的時候被省略，換句話說這句話我們通常會這麼寫：

> 但如果讀者的背景知識不夠，就沒有這個「腦補」的能力，也因此會看不懂你的句子

然而在英文中比較少會有這個問題，英文中往往會補個 `it`、`they` 之類的代名詞來表明主詞，以上方這句來說，它的英文通常如下：

> But if the reader lacks sufficient background knowledge, *they* won’t have the ability to "fill in the gaps" mentally, and as a result, *they* won’t be able to understand your sentence.

因此在翻譯成中文的時候，我常常需要有意識地把這個代名詞補上，否則當句子一長，或是主詞較多，你很容易忘記整段話的主詞是誰，例如這段原文在描述 RISC-V 多層頁表的結構（出自 xv6-riscv-book）：

> A page table is stored in physical memory as a three-level tree. The root of the tree is a 4096-byte page-table page that contains 512 PTEs, which contain the physical addresses for page-table pages in the next level of the tree. Each of those pages contains 512 PTEs for the final level in the tree. 

GPT 給我的翻譯為：

> 頁表在實體記憶體中是以三層樹的形式儲存的。這棵樹的根是一個 4096 位元組的頁表頁面，裡面包含 512 個 PTE（Page Table Entry），而每個 PTE 存放的是下一層頁表頁面的實體位址。這些頁面中的每一個也都包含 512 個最底層的 PTE

由於是在講多層頁表，所以這整段當中的主詞有「第一層頁表」、「第二層頁表」、「第三層頁表」。 然而在 GPT 的翻譯中，它並沒有強調原文中提到的三個 PTE 各屬於哪個頁表，因此我刻意地加上了主詞，將其翻為：

> 頁表在實體記憶體中會以三層的樹的形式儲存，這棵樹的根是一個 4096 位元組（一頁）的頁表，裡面包含 512 個 PTE，這些 PTE 內也各都存放著下一層頁表的實體位址（其也是用一頁來儲存）。 對於這些頁表，其內的每個 PTE 又都指向一個最底層的頁表，其內各包含 512 個最底層的 PTE

通過「各」來表達出「有多個」PTE 的概念，對應到原文就是「PTEs」裡面的「s」。 然後配上「這些」和「其」來表明這些 PTE 屬於哪個頁表

如同上面說的，這個真的很見仁見智，如果你背景知識足夠，那你讀 GPT 的翻譯時肯定能很快的知道各 PTE 屬於哪個頁表，甚至可能會覺得我翻的版本有些冗長。 但這只是我的解法，還有我意識到的問題，有許你有更好的翻譯版本也說不定

最後，並不是所有句子都要刻意地去加上主詞，畢竟中文句子省略主詞原本就是為了描述上的「連貫性」，例如下面這段原文：

> The paging hardware translates a virtual address by using the top 27 bits of the 39 bits to index into the page table to find a PTE, and making a 56-bit physical address whose top 44 bits come from the PPN in the PTE and whose bottom 12 bits are copied from the original virtual address.

我就會翻譯為：

> 分頁硬體會使用 39 位元中最高的 27 位元作為索引查找頁表，找到對應的 PTE，然後組合成一個 56 位元的實體位址：其最高 44 位元來自 PTE 裡的 PPN，最低 12 位元則複製自原本的虛擬位址

另外雖然不確定與翻譯有沒有相關，但語句越短，表現的語氣就越強烈； 語句越長，表現的語氣則越緩和。 姑且舉個例子（但目前想不太到什麼好的例子），像在聽到一件出乎意料的事情時，你可能會有以下反應：

- 哇
- 握草
- 真假
- 太扯了吧
- 怎麼可能
- 怎麼會有這種事情

出於是 Blog 文章就不打髒話上去了XD 但你可以很明顯的感受到越上方的語氣越強烈，這類語句我們通常會以「！」作為對應的標點符號，但後面的語句我們則是會加上「...」來幫助表達語境

### 主詞、重點要放對位置

例如以下原文：

> The three-level structure of Figure 3.2 allows a memory-efficient way of recording PTEs, compared to the single-level design of Figure 3.1.
 
GPT 給我的翻譯為：

> Figure 3.2 所示的三層結構，相較於 Figure 3.1 的單層設計，其提供了一種更節省記憶體的方式來記錄 PTE

而我將順序對調了一下，翻譯為：

> 相較於 Figure 3.1 的單層設計，Figure 3.2 所示的三層結構提供了一種更節省記憶體的方式來記錄 PTE

這是因為這段話內比較重要的主詞為「Figure 3.2 所示的三層結構」，在閱讀的時候，如果它的後面突然又多「補充」了一句話，才提到重點主詞對應的目標，那就會導致閱讀時思緒上需要來回切換注意的主詞，造成閱讀上的不順暢

簡單來說，重點在於

> 保持閱讀與思緒的連貫性

類似的道理還有像「前提」要先講，不要放到最後「補充」這類的語句順序問題，例如下面這段原文：

> This optimization is only effective when the data is already sorted.

GPT 給的翻譯可能會是：

> 這項最佳化只有在資料已經排序時才會有效

但我傾向將其翻為：

> 只有在資料已經排序的前提下，這項最佳化才會有效

這個例子比較短，所以效果看起來沒那麼強，比較有限，但當這整段話整整有四、五行的時候，這種語句順序對「閱讀的連貫性」的影響就會比較顯著。 也許我之後遇到可以再把這例子換掉XD

### 統一名詞用語

這不一定是針對專有名詞，例如「address」，盡量避免在同一篇文章中同時將其翻譯為「位址」與「地址」，針對這種有意義的名詞不要使用同義詞。 另外一個例子是「physical address」，不要在同一篇文章中同時將其翻譯為「實體位址」和「物理位址」，以避免混淆（雖然前者好像才是正確的繁體中文翻譯）

而對於專有名詞的中譯，可以參考以下連結：

- [資訊科技詞彙翻譯](https://hackmd.io/@sysprog/it-vocabulary)
- [詞彙對照表](https://hackmd.io/@l10n-tw/glossaries)

我不確定這類用語是否有個正確的「官方」翻譯，就我所知似乎只有對岸有這種東西，但如 jserv 在上面第一篇內所述，精準地名詞翻譯能避免歧義，例如「jump」不應翻譯為「跳轉」，因為「轉」有「等等會回來原本的地方」這個意義，但「jump」一詞本身並無該層意涵，因此應翻為「跳躍」

這類問題很多，雖然我本人對這方面並沒有那麼嚴謹，也很常因此被老師糾正，但我個人認為避免歧義確實是需要注意的部分

### 控制一個段落的長度在 3~4 行

以 Blog 的文章來說，一段話控制在三行左右是最好讀的，四行的話就有點多了，我自己抓的極限是五行，不能比五行更多，而且五行通常只會出現在我無法斷句的那種段落上。 而太短也不好，如果一段只有短短一句話（一行），則閱讀的時候也很容易沒注意到它

以下面這段原文為例（出自 RISC-V M-mode ISA）：

> The physical memory map for a complete system includes various address ranges, some corresponding to memory regions and some to memory-mapped control registers, portions of which might not be accessible. Some memory regions might not support reads, writes, or execution; some might not support subword or subblock accesses; some might not support atomic operations; and some might not support cache coherence or might have different memory models. Similarly, memory-mapped control registers vary in their supported access widths, support for atomic operations, and whether read and write accesses have associated side effects. In RISC-V systems, these properties and capabilities of each region of the machine’s physical address space are termed physical memory attributes (PMAs). This section describes RISC-V PMA terminology and how RISC-V systems implement and check PMAs.

你可以看到他非常的長，做完上方所述的潤飾後，翻譯的結果為：

> 一個完整系統的物理記憶體映射包含了多個不同的位址範圍，其中有些對應到記憶體區段，有些則對應到記憶體映射的控制暫存器，而這些區段中有些可能是無法存取的。 有些記憶體區段可能不支援讀取、寫入或執行； 有些可能不支援 subword 或 subblock 存取； 有些可能不支援原子操作； 也有些區段可能不具備快取一致性或採用了不同的記憶體模型。 記憶體映射的控制暫存器在存取寬度、是否支援原子操作、以及讀寫是否具有副作用（side effect）等方面也有所不同。 在 RISC-V 系統中，這些機器的物理位址空間中的每個區段的屬性與能力，被稱為 physical memory attributes（PMAs）。 本節將說明 RISC-V 中 PMA 的術語，以及系統如何實作與檢查這些屬性

可以看到整段擠成了一坨，非常難閱讀，此時就可以找一些斷句的地方來將其分為 3+3 或 2+4 的段落：

> 一個完整系統的物理記憶體映射包含了多個不同的位址範圍，其中有些對應到記憶體區段，有些則對應到記憶體映射的控制暫存器，而這些區段中有些可能是無法存取的。 有些記憶體區段可能不支援讀取、寫入或執行； 有些可能不支援 subword 或 subblock 存取； 有些可能不支援原子操作； 也有些區段可能不具備快取一致性或採用了不同的記憶體模型<br><br>
> 
> 記憶體映射的控制暫存器在存取寬度、是否支援原子操作、以及讀寫是否具有副作用（side effect）等方面也有所不同。 在 RISC-V 系統中，這些機器的物理位址空間中的每個區段的屬性與能力，被稱為 physical memory attributes（PMAs）。 本節將說明 RISC-V 中 PMA 的術語，以及系統如何實作與檢查這些屬性

肉眼可見地好很多對吧？

### 列點的時機

這個問題困擾了我一陣子，後來我在 [FB 上看到了一篇文](https://www.facebook.com/share/p/1G2JEixW8c/)，算是給了我解答，他提到列點的壞處如下：

> 列點確實在形式上破壞了一些論述空間。 要把一個想法講清楚，列點是不行的，或至少在關鍵論點上是不行的

該文提到《曼報》大量使用列點，主要的考量為：

> 現在的《曼報》大量使用列點，是因為我在日常更新中放棄「論述」。 改版後的電子報，除非是長文，否則我沒有什麼自己的論述，而是將觀點表現在選題以及事實的篩選上。 當我想要較深入地論述一件事的時候，我就不會使用列點

我完全認同他的觀點，也和我遇到的問題差不多。 但是也有一些段落是站在邊界上的，它們可以使用列點來乾淨地表現事實，但其原文又有點像在論述，或說描述事實，例如下面這段原文（出自 RISC-V M-mode ISA）：

> To support nested traps, each privilege mode x that can respond to interrupts has a two-level stack of interrupt-enable bits and privilege modes. xPIE holds the value of the interrupt-enable bit active prior to the trap, and xPP holds the previous privilege mode. The xPP fields can only hold privilege modes up to x, so MPP is two bits wide and SPP is one bit wide. When a trap is taken from privilege mode y into privilege mode x, xPIE is set to the value of xIE; xIE is set to 0; and xPP is set to y.

這段在講巢狀 trap 的支援，它可以用列點來很清楚的表現出發生巢狀 trap 時 `xPIE` 和 `xPP` 內該存什麼：

> - 為了支援巢狀的 trap，每個能響應中斷的權限模式 `x` 都會有一個兩層的堆疊（stack），分別用來儲存先前中斷啟用位元的值與權限模式
>   - `xPIE` 儲存 trap 發生前 `xIE` 的值
>   - `xPP` 儲存 trap 發生前的權限模式
> - `xPP` 欄位只能記錄小於等於 `x` 的權限模式，因此 `MPP` 是 2 位元寬，而 `SPP` 是 1 位元寬
> - 當從權限模式 `y` 進入權限模式 `x` 的 trap 時，會將 `xPIE` 設為當前 `xIE` 的值，然後將 `xIE` 設為 0，`xPP` 設為 `y`

但你會發現不列點的話閱讀的連貫性會比較強：

> 為了支援巢狀的 trap，每個能響應中斷的權限模式 `x` 都會有一個兩層的堆疊（stack），分別用來儲存先前中斷啟用位元的值與權限模式。 `xPIE` 儲存 trap 發生前 `xIE` 的值，而 `xPP` 儲存 trap 發生前的權限模式。 `xPP` 欄位只能記錄小於等於 `x` 的權限模式，因此 `MPP` 是 2 位元寬，而 `SPP` 是 1 位元寬。 當從權限模式 `y` 進入權限模式 `x` 的 trap 時，會將 `xPIE` 設為當前 `xIE` 的值，然後將 `xIE` 設為 0，`xPP` 設為 `y`

前者能更清晰的將規則表現出來，但後者能幫助閱讀時建立連貫性：「為了支援巢狀 trap」⇒「`xPIE` 與 `xPP` 會存什麼」

後來考量到該篇文並不是所有段落都適合列點，而且大部分適合列點的段落也都如上例，不用列點也能表達得清楚，因此最後我選擇以不列點的方式來表現。 然而在另一篇 S-mode ISA 的筆記中我大部分的段落都以列點的方式來呈現

## 結語

總覺得平常遇到的問題更多，但今天臨時這樣寫一篇，要能想到問題，並找到例子解釋也是有點困難，未來如果有想到什麼我可能再慢慢補充進來吧，各位也可以參考一下[自由軟體正體中文化翻譯風格指引 (Traditional Chinese L10N Translation Style Guide)](https://hackmd.io/@l10n-tw/translation_style_guide)

祝各位寫文順利
