---
title: Ch2 OS Structure
date: 2021/12/20
tags: OS
categories:
- OS
---

# Ch2 OS Structure

## OS Services

OS 就在幫 user 做事，有很多事一定要 OS 才能做，所以我們稱 OS 為 services

### User Interface

Interface 大家應該都很熟悉，其實只分兩個：

+ CLI (Command Line Interface)

    下指令的介面，下的指令其實不是直接到 OS 手上，這個下指令的介面是一個程式，在 OS 的世界裡我們通稱為 Shell，常見的 shell 有 CShell、Bash。
    
    多了這一層，這一個介面的原因是一台電腦可能不只有一個使用者，每個使用者的習慣都不同，下 command 的方法可能也都不一樣，這樣就可以透過修改 Shell 設定檔的方式來達成。
    
    OS 還是以系統角度出發，System call 定義好就不能改了，而且是這台電腦上所有的程式都要 follow 的。但不同的使用者還是有不同的習慣，所以就需要一層 shell 在 OS 上面。

+ GUI (Graphic User Interface)
    
    圖形介面，基本概念就是透過 Icon，方便。
    
現在大多數的作業系統都同時有 CLI 和 GUI。

### Communication Models

這邊只是很簡單的講個基本概念，這裡的 Communication 指的不只是 Process 與 Process 之間，也可以是跨電腦的 level。

但不管是哪種，我們都可以透過 memory 的使用把 Communication 切成兩大類：

![](https://i.imgur.com/UxK49Kx.png)

1. message passing

    message 就是一般的概念，Process A 把 message 複製到 kernel，也就是 OS 的 memory，然後再讓 Process B 去複製去讀。
    
    簡單來講就是 memory copy，但這個 copy 不是直接複製過去的，而是先到 kernel 這樣繞了一圈的。
    
    要這樣做的原因主要是 Protection 的考量，每個 Process 都有自己的 base 與 limit，如果直接去 copy，那就越界了，因此這麼簡單的事情才也需要 system call。
    
    缺點是因為要一直 copy，所以速度相對來說比較慢。
    
2. shared memory

    兩個 Process 共享同一塊 memory，都有權利去讀寫這塊 memory，這樣兩個 Process 就可以利用這塊 memory 溝通。
    
    但這塊 memory 也是需要先跟 OS 講，透過 system call 來生成的。
    
    缺點就是會有 Synchronization 的問題，B 改完 A 可能沒發現資料已經被動過了。
    
    最常見的地方大概是 multi-thread programming。

用 memory 來分的理由應該顯而易見，因為 cpu 能直接 access 的就是 memory，但兩種都一樣要透過 OS。

## OS-Application Interface

一開始說 OS 提供了各式各樣的 service，這些服務提供的方式就是 function call，或我們叫它 API，這邊指的是 Program 層面，而不是剛剛說的 CLI 與 GUI 那些的。

### System Call

由 OS 提供的 function call 就是 system call，他是唯一的 interface，所以在 OS 上面會有一個 system call layer，因為它是直接與 OS 緊密連接在一起的，所以通常認為他是 OS 的一部份，處於最外層 interface 的那邊。

因為是 OS，所以講究效能，因此 system call 有幾個特性：

1. 本身就是 software interrupt

    這樣才有機會去切換 user mode 與 kernel mode，所以當你 call 了 system call 後，一定會進到 kernel mode。
    
2. 通常都是用 asm 寫的

    在上層還有 shell 等其他東西，所以有其他東西會解決方便性的問題。

### API

因為 system call 不好用，所以通常在上面會再多一層 API layer，全名叫 Application Program Interface，顧名思義就是為 Programming 方便而設計的，與 OS 沒有那麼緊密的關係。

API 下面是 system call，system call 會下去呼叫 OS 裡面的 service routine。

這些 API 的形式就是一堆 Library，事實上最常見的 C Library(libc) 就被定義為一個系統 API，但當然這不是唯一的，有些手機上的 API 就是使用 Java 寫的。

API 與 System call 是不同 layer，但他們的角色並不是單純在做 translation 與 forwarding 而已，他們是兩個 layer，所以根本上的目的是不同的。

也就是說一個 API 的 function call，可能會需要很多個 system call 來完成，這樣是一對多的關係；也有可能有那種完全不需要 system call 也能做完的 API，兩個 layer 的對應是沒有絕對的關聯性的。

API 的目的是方便使用者使用，所以像 `abs()`，取絕對值的 function，就不需要使用到 system call，但 `malloc()` 與 `free()` 就都會用到 system call `brk()`，雖然他們的功能不一樣，但底下用到的 system call 是一樣的。

要注意 Call 了 API 並不一定會進到 kernel mode，不一定會有 interrupt，因為不一定會用到 system call。

比較常見的 API 有 Windows 上的 Win32 API、Unix 的 POSIX API 與 JVM 的 Java API。

![](https://i.imgur.com/B68JSa9.png)

### Parameters Passing

system call 一樣是 function，所以也會有參數需要傳遞，一般來說會有三種方法來傳遞參數：

1. 直接放在 registers

2. table in memory
    
    當 parameters 很多的時候，系統可能會創建一個 data structure，然後把這個 data structure 的 pointer 傳進 function call。
    
    這個 function 拿到 pointer 後就可以去讀裡面的參數。
    
3. stack

    每個 Process 都有一塊 memory 叫 stack，可以把東西 push 進去和 pop 出來，有時參數也會 push 進 stack，然後透過 OS pop 出來，這樣來傳遞參數。

## OS Structure

### Simple OS Architecture

最早期的 OS 幾乎沒有架構，除了 Driver 與 OS，其他東西都混在一起，因為那時候最重要的是 User friendly，例如早期的 MS-DOS 與 Unix。

因此就非常的不安全，且很難 maintain，所以早期電腦才會有那麼多的 worm。

![](https://i.imgur.com/WGCtxak.png)

### Layered OS Architecture

很快地大家就發現上面那個不是一個很好的 solution，至少以系統的角度不是，所以就有人提出了 Layer 的概念。

因為 OS 是個很大的 Program，裡面會有很多的 subsystem，像是 I/O、memory、driver 等等，OS 執行起來是很多個 Process 被執行，然後彼此互相溝通。

因此就把這些 subsystem 分層，外面的 Layer 可以 call 裡面的，但裡面的不能 call 外面的，以下圖來說就是 I/O 可以 call Memory，但 Memory 不能 call I/O，所以在設計上就不應該提供後面那個 function call，因為會破壞定義好的 layer。

![](https://i.imgur.com/Bibydj8.png)

好處是比較好 debug 和 maintain 了，因為一個 program 在執行時會有 call path，所以我們可以一層一層去 test。

但缺點是比較沒有效率，因為有 layer，所以就跟 socket programming 的缺點類似，可能會有很多 memory copy，沒辦法直接跳到某一個地方去 call function，另外有些時候 layer 會很難定義，像是上面那個例子，Memory 可能也會 call 到 I/O。

### Microkernel OS Architecture

Microkernel 主要的想法是 kernel 的程式碼應該要越少越好，因為這樣比較 reliable，因為只要那些 code 沒有 bug 就好。

此時就有 modulize 的概念進來了，因為他把每一個 subsystem 都變成一個個的 module，中間的 kernel 只是負責去溝通這些 module，看怎麼傳輸，怎麼 handle interface 等等。

所以如果系統裡面有新的 I/O Device，甚至是新的 Memory Management，想要把舊的換掉，只要把原本的 Module 換掉，把新的 hook 上來就好，他並不屬於 OS 的一部份。

當時比較嚴謹的定義是只要是在 kernel 外面的，都算在 user space，所以下圖的 I/O Manager、Graphics Subsystem 等都跟普通的 user program 一樣，也因此他 crash 也沒關係。

![](https://i.imgur.com/RAoRVqp.png)

缺點很明顯是效能又會變得更慢，因為每個 subsystem 都是在 user space，所以每次 subsystem 之間在溝通的時候都要透過 kernel，這都是 system call，前面的不管是 Layered 或 Simple，都是在 kernel space 裡面，所以在溝通的時候不會有 Interrupt，直接就可以 call。

另外因為有 Synchronization 的問題，所以她溝通的方法是 message passing，這樣參數一定要傳遞，所以會有 memory copy，就會變慢。

### Modular OS Architecture

這是現在最常見的一個，因為就像 OO 概念一樣，跟剛剛一樣，會有很多 subsystem，用 OO 的方式去寫 OS，差別是這些全部都在 kernel space，所以彈性就會比較高，至少在溝通就不需要透過 message passing。

Modular 有一個很重要的點是它 loadable，也就是可以去 load kernel module 進去，這樣便能夠改變 OS 的 feature。

![](https://i.imgur.com/Y3nl84I.png)

kernel module 的運作可以看上圖中間右邊，只要是 system call 就會有 interrupt，interrupt 會到一個 table，Signal 的話是 interrupt vector，而 Trap 這邊也會有 interrupt table，前面說過通常是用 switch case 的方式來做，所以這 table 會有些 entry 是空的。

所以這樣你用 administration permission 的時候，就可以 insert module，也就是去改 table 的 entry，如此一來便能定義新的 system call 了。

但最常見的做法其實是 replace，例如本來有個 system call 叫 `fopen`，然後我們 insert 一個 override，去覆寫那個 entry，第一行可能偷偷加上個 `print file name`，然後後面再把原本 open file 的 code 貼上去，這樣就不會影響到系統運作，且成功改寫 system call 了，這個技巧可以攔截 system call，幫助我們 debug。

## Virtual Machine

VM 的概念其實很早就出來了，因為早在大家思考 OS 設計前就有一台電腦多使用者的需求了，所以就有人想要用 VM 的方式來解決這個問題。

VM 可以把底層的架構抽象化，在底層已經灌了一個 OS 的情況下，我們可以在上層透過 VM 的技術再灌一個 OS，然後把既有的 OS 抽象成好像不存在一樣，這樣 VM 的環境裡面就好像它本身就是一台獨立的電腦，原來的 OS 我們稱他為 host，VM 的 OS 我們稱它為 guest。

虛擬化技術的困難處在於我們的 software 在設計的時候自己就有些對於硬體的 assumption，其中一個很大的困擾的是 critical instruction，它不是 privileged instruction，但這種 instruction 很特別，它在 user mode 和 kernel mode 的執行結果不一樣。

下圖左方是原本正常的狀況，硬體上方直接就是 OS，而右方則是有 VM 的狀況，硬體上會有原本的 OS 和一些管理的軟體，然後再上面我們可以去創建 VM，VM 與 VM 間並不知道彼此的存在。

![](https://i.imgur.com/T14SHtL.png)

另外前面提到的虛擬化指的並不是去修改上圖 VM 上方的 kernel，而是指如何在硬體上方增加一個 layer 讓電腦可以同時執行很多個 VM。

最主要的一個困難點是 user space 與 kernel space 的問題，kernel 在運作的時候會假設自己在 kernel space，但在 VM 的設計下，VM 上的 kernel 其實是裝在 user space 的，所以當他執行 privileged instruction 的時候就會出現問題，因為實際上它是在 user space。

解決方法有很多種，最常見的方法，在 VM 的 kernel 要執行時因為是在整個電腦的 user space，所以會丟出 exception 告訴我們這是一個非法的指令，所以會被擋掉，但在被檔的時候，這個 interrupt 會先回到 OS，這時他就知道上面那個 VM 要執行 privileged instruction，此時 OS 就可以幫他執行，所以 OS 就再 call 一次剛剛 VM 想執行的 interrupt，但這次就會過了。

### Usage of Virtual Machine

使用 VM 有很多好處，像是

1. protection

    VM 可以保護我們的 OS，因為它本身就是一個獨立的環境。

2. 兼容性

    有些軟體可能會有特定需求的環境，例如一定要 windows98，但我們也需要用其他的軟體，不能直接把整台電腦換成指定的環境，所以我們可以用 VM 來解決這個問題。

3. 開發用

    當我們想做 kernel 的研究時，因為 kernel 一有 bug 就會整個 crash，如果用實機來研究，要一直重新開機，硬體也很有可能會壞掉，但如果用 VM 就沒這個問題了。

4. honey bound

    在做資安時很常要研究一台電腦是如何被攻擊的，如果用實機，電腦被攻擊後可能整個資料就被銷毀了，但用 VM 就可以解決這個問題，我們可以把資料存在真正的 OS 上
    
5. 雲端計算

    現在大家講求的是資源的共享，自己的電腦資源有限，這個技術的重點是 resource sharing，一台機器會被切成很多台 VM 供大家使用，然後也方便管理。

### Virtualization

1. Full Virtualization
    
    Full Virtualization 代表只要是可以裝在一般電腦的 OS，也可以直接裝在 VM 裡面，不需要調整，OS 完全不會知道自己是裝在 VM 裡面，所以叫做 Full Virtualization。

    ![](https://i.imgur.com/FWF3Zo2.png)

2. Para-virtualization

    差別在會多一個 global zone，我們通常叫他 manager，這是個特殊的程式，他知道所有的 VM 的存在，另外 裝在上面的 OS(guest) 也需要被修改，好處是這樣就可以開一些後門了，速度也不一定會比較慢。

    ![](https://i.imgur.com/AJCRCr1.png)

3. Java VM

    Java 本身執行的方式就像執行在一個 VM 上，但相對來說這個 VM 單純很多，因為只是要執行 instruction。
    
   Java 編譯完後會有自己的 binary code，它不是 x86，也不是 misc，也不是任何一個硬體的指令，它是 JVM 上的 bytecode。
   
   當要在電腦執行時，它會再根據電腦的環境往下做 translation，因為 JVM 類似一個 OS，所以對於這些 code 所使用的 memory 會有很好的 isolation，也就是說再怎麼寫，它仍然只會使用那個 VM 裡面的 memory，所以對於 host OS 而言，裡面的 code 不管怎麼執行都不太會影響到別人。

    ![](https://i.imgur.com/fidw235.png)


