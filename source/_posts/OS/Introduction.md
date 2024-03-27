---
title: Ch1 基礎概論
date: 2021/12/10
description: 簡單介紹了整學期會教到的東西
tags: OS
categories:
- OS
---

# Ch1 基礎概論

## 什麼是作業系統?

### Introduction

「作業系統（英語：Operating System，縮寫：OS）是一組主管並控制電腦操作、運用和執行硬體、軟體資源和提供公共服務來組織使用者互動的相互關聯的系統軟體程式」── [wiki](https://zh.wikipedia.org/wiki/%E6%93%8D%E4%BD%9C%E7%B3%BB%E7%BB%9F)

簡單來說就是一個管理電腦的系統程式，是使用者和電腦硬體的介面 (interface)。

### Computer System

整個電腦系統主要可以分成四個部分：硬體、作業系統、應用程式和使用者，這邊先對它們做個簡單的介紹，但這些不是定義，只是一個描述

+ 使用者(User)
    
    使用者可以是人、機器或其他的電腦，只要是可以操控這台電腦的都可以算
    
+ 應用程式(Application)

    能幫助使用者解決問題的軟體都可以算，像是 Browser、Compiler 或一般的 Text Editor 都算
    
+ 硬體(Hardware)

    能夠拿來給我們操作，做運算的硬體，因此硬體在 OS 這邊我們習慣稱它們回資源 (resources)，我們不在意它是透過哪種硬體提供的，只在意它能夠提供哪種資源，可以怎麼運用它
    
+ 作業系統(Operating System)

    能夠幫助我們「控制(control)」和「協調(coordinate)」資源的系統軟體。
    
    控制(control) 指的大概就是 Device Driver，能夠幫助我們去控制硬體的，重點在協調(coordinate)，怎麼樣去協調使用者，分配資源，是 OS 裡面比較複雜的部份。
    
    因此我們也可以說 OS 是幫忙分配資源的軟體(resource allocator)，像是 memory management 會幫忙分配記憶體，file system 會幫忙分配 disk block 等等
    
    因此 OS 比較常見的定義是一個 resource allocator 和 control program，我們也稱它為 kernel，是一個在電腦內部隨時都在執行的程式，前面兩個名詞可以不用特定去記，因為只是一個比較常見的定義，但其實沒有很確切的定義 OS 是什麼，<span class="yellow">但 kernel 這個名詞很重要，要記一下</span>。

因此作業系統就會有一些 for virtual resource 的 API 可以使用，這些 API 我們也常稱它為 system call，<span class="yellow">這些 API 是 user 與 resource 間唯一的 interface</span>。

### Example

我們看一個例子：

![General_Purpose_Operating_Systems](https://github.com/Mes0903/Mes_Note/blob/main/Operating_System/Ch1_Introduction/Image/General_Purpose_Operating_Systems.jpg?raw=true)

最下面是硬體，上面則是我們寫的程式，程式大致上可以分成「和作業系統相關的」與「和作業系統無關的」，也就是圖上的 user mode 與 kernel mode，這在後面的章節會再提更多。

Device Driver 也算 OS 的一部份，把它抽出來是因為它是可以一直更新、抽換的；Driver 上面就會有 OS 的主要部分，也就是如何管理 memory、cpu 等等的軟體，這個軟體會提供一些 API，也就是前面提到的 System call，OS 會把它包起來成 System library，讓我們使用。

我們寫完 Program 後要先 Compile，然後透過 Linker 把這些 Compile 完的 `.o` 檔 link 在一起，代表我們要去使用別人 implement 好的 Program，因此他不會只 link 我們 include 的那些 library，也一定會 link System library，link 完後才成為一個能執行的執行檔。

以 `printf` 來舉例，我們要印出東西在終端機上，這個動作不會是 C library 去做，而是 OS 去做的，需要呼叫到 system call，可能不是直接呼叫，但一定間接會呼叫到它，所以一定要 link System library，等到後面講 system call 時會更清楚。

因此這個過程中我們會先呼叫 `printf`，然後會呼叫到 system call，再去呼叫到 driver 這樣一層一層下去。

### Goals of an Operating System

OS 主要的考量、需求有二：

1. 方便
    尤其是越接近使用者的產品，方便性越重要。

2. 效率
    如果執行一些比較複雜的程式，像是遊戲，或是你要算什麼東西的時候，就希望它效率會快一點，換句話說就是 performance 要好一點。

而這兩點是 trade-off 的，因為「方便」是給 user 的，一定會多加到一些東西，所以速度就會慢下來，因此就看怎麼設計怎麼取捨。

### Modern Operating Systems

這邊列幾個常見的 OS：

+ x86 platform

    + Linux
        像是 CentOS、Redhat、Ubuntu 等等的，大型的系統還是會選擇 Linux，主要是因為它是 open source 的。

    + Windows
        這就是一般使用者比較熟系的 OS。

+ PowerPC platform

    如 Mac OS。

+ Smartphone Mobile OS

    如 Android、iOS、Windows10 Mobile、Ubuntu Touch 等等。

+ Embedded OS (嵌入式系統)

    Embedded 的範圍非常廣泛，像是物聯網上面的 Device 形形色色，因此在上面的 OS 就需要非常有彈性，且能夠調整，但當然也有一些 OS 是綁在那個硬體上的。
    
    如 Raspberry Pi、Xbox 等等

## Computer-System Organization

知道了 OS 的定位、角色之後就要開始講它到底是如何運作的了。

電腦系統有很多不同的 Hardware，我們需要把它串起來，你把主機打開來可以看見它有 bus、線，而作業系統的目的就是要控制、協調這些硬體的使用，可以看看下面這張圖：

![Computer_System_Organization](https://github.com/Mes0903/Mes_Note/blob/main/Operating_System/Ch1_Introduction/Image/Computer_System_Organization.jpg?raw=true)

簡單來說就會長上圖最下面那樣，執行程式時 instruction 是 run 在 cpu 上的，需要用到的 data 會在 memory 裡面，最後可能寫到某個 Device 上面，看要儲存還是輸出之類的，這些是 control 的部分。

而 coordinate 部份的問題是今天可能有很多程式，OS 需要讓它們能夠同時執行在這台電腦上而不出錯，像是 A Process 不能去修改到 B Process 的資料之類的。

### Computer-System Operations

這是一個 OS 基本運作的例子：

![Computer_System_Operations](https://github.com/Mes0903/Mes_Note/blob/main/Operating_System/Ch1_Introduction/Image/Computer_System_Operations.jpg?raw=true)

這邊 Cpu 想對一個 I/O Device，像是 Disk 做動作，例如讀寫資料。

如果 Cpu 想要把資料寫過去，那它會需要一個 Device Controller，這是一個硬體，它是一個最 low-level 能夠控制 Device(例如 Disk 的磁頭轉動) 的硬體，每個 Device Controller 會負責自己特定的 Device。

而因為資料需要在 Device Controller 上流動，因此 Device Controller 一定會有 buffer，資料會先寫到這上面再寫出去，因為 I/O Device 相較於 cpu 很慢，如果沒有這個 Buffer，代表我們要直接把資料從 Device 上 Copy 到 Memory 裡，這個需要很久，因此 cpu 一定會 idle。

而為了要透過 buffer 去讀寫，Device Controller 就會需要有 Status Register 和 Data Register 來控制 Device Controller。 Status Register 會告訴它現在是 busy 還是 idle；Data Register 則可以想像成另一個 buffer，我們先很快寫到 Register 上，再寫到 buffer。

因此在讀資料時，I/O Device 需要先和 Device Controller 做 I/O，跟 cpu 無關，但是後面因為 memory 是 cpu 在使用的，所以後半段的操作就需要 cpu 去下指令操作。

### Busy Waiting

那麼 cpu 那邊要怎麼控制呢? 一個早期大家想到的最簡單的方法就是 Busy Waiting，完全由 cpu 來控制，這邊舉個簡單的例子：

```c
#define OUT_CHAR 0x1000    // device data register
#define OUT_STATUS 0x1001    // device status register

current_char = mystring;
while ( *current_char != '\0') {
    poke( OUT_CHAR, *current_char );
    while ( peek( OUT_STATUS ) != 0 );    // busy waiting
    current_char++;
}
```

這邊我們想要把一串字串寫到 I/O Device 上，因為 buffer 空間大小的關係，且 cpu、memory 那邊的速度遠快於 I/O Device 的速度，因此我們不可能一次把全部的資料塞進 buffer，或像 streaming 那樣資料不停的流動，所以 Busy Waiting 的方式就是，如果 buffer 寫滿了，就等到 buffer 寫到 Disk 上，清空後再寫下一批。

所以 cpu 這邊的 code

```c
while ( *current_char != '\0')
```

是在判斷字串結束了沒，`poke` 是把值寫到 buffer，而我們在寫的時候，因為怕 buffer 還沒清空，是 busy 的狀態，所以會需要一個 while loop 去看 Status Register 的值：

```c
while ( peek( OUT_STATUS ) != 0 );    // busy waiting
```

如果是 busy 的，就停在那邊等，所以才叫 Busy Waiting；當值不等於 `0` 時，代表已經沒事了，就可以換下一個字了。

因此整個做 I/O 的時間並不是真正在寫的時間，中間有花一段時間在等 buffer 清空，也就是 cpu 有某種程度的 idle。

如果我們是這樣做 I/O 的，那整個效率就會很差，因為 I/O 和 cpu 並沒有 overlap，一個程式在做 I/O 的時候仍會霸佔住 cpu。

### Interrupt

因為 Busy waiting 非常沒有效率，在檢查是否為 busy 時 cpu 沒法做其他的事，會整個卡在那邊，也因此會很難同時處理多個 I/O。

所以就有另外一個方式叫做 Interrupt，這是一種 event driven 的架構。

所謂的 Interrupt 就如其名，可以改變 cpu 控制的 flow，也就是說 cpu 可能正在執行某段程式碼，但妳可以透過 Interrupt 把他打斷，叫他去做另一件事情。

用這張圖來看：

![Timeline](https://github.com/Mes0903/Mes_Note/blob/main/Operating_System/Ch1_Introduction/Image/Timeline.jpg?raw=true)

假設有了 Interrupt，對於 I/O 而言就會像圖上這樣。cpu 在高電位代表他正在做他該做的事，在低電位代表他去處理別的程式的事情；而 I/O 則是反過來的，高電位代表 idle，低電位代表正在傳輸，而且花的時間可能會很長。

因此我們原本的程式與資料傳遞可以同時執行，而當資料傳遞結束時，就有點像 buffer 滿了，這時要搬到 memory，就需要 cpu 來幫忙，因此 I/O 那邊會發出一個 Interrupt，把原本 cpu 執行的程式先打斷，讓它切到要做 I/O 的那個 subroutine 去處理搬資料的工作，結束後 cpu 再回去執行剛剛被打斷的程式。

整個核心概念就是，cpu 可以先做自己的事，當有需要 OS 來做事時，可以隨時透過 Interrupt 把 cpu 從 user 的程式切換到 OS 的程式，去做現在整個電腦系統比較需要做的事，且做完後能夠回去繼續做自己的事。

那我們來看個例子，情境是使用者要執行 `scanf`，而最終當然會到最底層去 call 到 driver：

![Interrupt_Driven_IO](https://github.com/Mes0903/Mes_Note/blob/main/Operating_System/Ch1_Introduction/Image/Interrupt_Driven_IO.jpg?raw=true)

一開始 cpu 會下指令給 controller，讓它開始搬資料，cpu 可能還會給個 byte 的長度，像是 100 bytes，然後 controller 搬完後再去通知 cpu。

所以 I/O Controller 就會開始搬資料，搬完後會送一個 Interrupt 出去。在這過程 cpu 可能會切換到別的程式，以 scanf 來說，當 A 程式執行到這行時就會停在這裡等使用者輸入，此時 cpu 就會切換到 B 程式之類的去做其他事。

當 cpu 收到 Controller 的 Interrupt 時，就會打斷剛剛執行的程式，確認 A 的 scanf 做完了，然後看看要接著執行 A 還是繼續做 B，看 cpu 的 scheduling 怎麼決定，它可能會但總之它會知道 A 的 I/O 已經做完了。

所以回到圖裡，cpu 接到 Interrupt 後，會有一個 interrupt handler 先去確認剛剛 I/O 的動作已經做完了，然後看要把原本的程式啟動起來，或是把它的狀態改成可執行之類的。

以上面那個例子來說就是把 B 打斷，然後把 A 的樣子弄成 I/O 剛做完的狀態，這樣子 A 跟 B 就都可以繼續執行了。

所以接下來就可以回復正常，通常會是繼續做 B，但也有可能 A 是個 Priority 很高的程式，所以當 A 的 I/O 一執行完後他就馬上接著做 A 後面的事了。 

可以看見這種 event driven 的設計就不會浪費 cpu 了，但上面那個只是一種 Interrupt 的流程，妳還有很多其他的方式可以 trigger Interrupt，像是移動滑鼠，按鍵盤之類的。

所以 Interrupt 還有分硬體，軟體發出的兩種，由<span class = "yellow">硬體</span>發出的我們叫它 「<span class = "yellow">signal</span>」；而軟體的話還有兩種情況，一種是非預期的，這種就叫它<span class = "yellow">「error」</span>，當程式有錯誤時，就會丟出一個 Interrupt，程式就不會繼續執行下去，program counter 會換到 recovery 的部分，OS 會有 Interrupt handler 去處理這部分的問題。

另一種就是 <span class = "yellow">system call</span>，system call 與一般的 function call 最大的差別就是 system call 一定是透過 Interrupt 來處理的，比如我們 call 了一個 `write up to screen`，這時它會丟一個 Interrupt 出來，然後 OS 會看這是對應到哪個 subroutine，再去做處理，處理完再去通知它已經處理好了。

所以 system call 是間接被處理的，要間接處理的原因是我們需要區分程式這個 function call 是 OS 的 function call 還是是 user 的 function call，因為 OS 的一定要透過 Interrupt，這個過程 OS 就可以去檢查這是不是有效的 Interrupt，有效的 Interrupt 都有被定義好，不能被繞過去。

而我們把 error 與 system call，也就是軟體送出的 Interrupt，統稱為 <span class = "yellow">trap</span>。

### Hardware Interrupt (Signal)

那我們現在來仔細看一下他的流程，首先是 Signal：

![Signal](https://github.com/Mes0903/Mes_Note/blob/main/Operating_System/Ch1_Introduction/Image/Signal.jpg?raw=true)

這整條是 memory，下面的是 user 的 Program，上面的是 OS。 

本來我們在執行某個程式，突然有個 Signal 進來，像是前面提到的滑鼠移動，這時就會打斷正在執行的程式，然後 OS 會偵測到這個 Interrupt，此時 OS 會先去看一個東西叫 Interrupt vector，這是一個 array of function pointer，這個 array 裡面放了所有定義好的 Signal 的函式指標。

OS 收到的 Signal 會有一個 Signal number，然後 OS 再透過這個 number 去看是對應到哪個 function call。

所以當妳在裝 Driver 的時候，妳的 Device 會插到電腦的某個 port，這個 port 是已經燒死的，有一個 Signal number，會對應到某個欄位，而妳把 Driver 裝進去時就會 Override 這個欄位，如此一來妳的 Device 發出 Signal 後就會去執行對應的程式碼了。

拿到 function pointer 後，它就可以被重新導向那個 function 裡面去做應該做的事，這個處理 service function call 的流程我們叫它 Interrupt Service Routine (ISR)。

最後還要 return 回原本正在執行的程式，所以當初發出 Interrupt 時其實會記錄當初 interrupted instruction 的 address，也就是 program counter 的位址，所以他 restore 後就可以知道等等要從哪裡繼續開始。

妳可以發現 Interrupt vector 的大小是固定的，因為它是跟 Hardware 綁在一起的，妳一個主機板買來它就有固定的 Signal handler number，妳只能替換掉裡面的東西。

### Software Interrupt (Trap)

接下來是 Trap，一樣看一下它的流程：

![Trap](https://github.com/Mes0903/Mes_Note/blob/main/Operating_System/Ch1_Introduction/Image/Trap.jpg?raw=true)

跟前面不一樣的是，Trap 是 Program 主動需要 OS 幫忙的，所以會是一個 program 裡用了某個 system call，或是寫了某些不合法的操作，像是訪問了陣列大小以外的元素，或某個數字除以 0 了，造成 OS 需要來幫你處理後續。

但整體流程跟 Signal 差不多，發出 Interrupt 後一樣會記錄 program counter 的位址。不過要注意，Trap 和 Signal 仍然是不同的，所以處理時是進到不同的 function 裡。

而妳可能會注意到這邊不是用 array 來操作，而是 `switch case`，因為這是 software 發出的，所以有無限的可能性，只要妳能定義好那些 system call 就可以實現，所以這個數量並沒有被限制，因此在實作上就會變 switch case。

但總之一樣會有個 number，讓它可以去查是對應哪個 function call，並去執行那個 routine，然後再回到剛剛被打斷的 Process。

### 補充

妳可能會想到當我 Interrupt Service Routine 執行到一半時又收到 Interrupt 怎麼辦？ 這樣的話會不斷不斷被打斷，如此一來就會需要紀錄很多的資訊，像前面提到的 program counter 的位址，完成後才能回到上一個狀態，間接成本就會很高。

尤其是到後面，兩個 Process 不斷的在切換時，就會有 Synchronization 的問題出現，要解決這問題就會浪費很多時間，但 OS 的速度需要很快，不然你會感覺電腦很當，一移動滑鼠，滑鼠就要動。

所以比較單純的作業系統，一旦 Interrupt 產生，它會 Diabled Interrupt，也就是後面的 Interrupt 它都當作沒看見，這樣就可以跳開 Synchronization 的問題。

所以 Interrupt 是可以被 mask 掉的，會有 High Priority 與 Low Priority 的 Interrupt，當 High Priority 的 Interrupt 正在被執行時，Low Priority 的 Interrupt 全部會被無視，所以有時候妳動滑鼠就會沒反應，因為它可能卡在某個 routine 裡面。

## Storage-Device Hierarchy

接下來要講電腦資料讀取的基本方式，大家應該都很熟悉了，電腦資料在儲存其實是一個 Hierarchy 的架構：

![Storage_Device_Hierarchy](https://github.com/Mes0903/Mes_Note/blob/main/Operating_System/Ch1_Introduction/Image/Storage_Device_Hierarchy.png?raw=true)

上面三個分別為暫存器、快取、主記憶體，而後面的則統稱為次級儲存裝置 (Secondary Storage)。 越上層的速度越快，容量越小，反之越下層的速度越慢，但容量越大，價格也比較便宜。

這些只是傳統上的分類，現在有很多新的裝置會插在中間，但一樣可以用速度、價格、容量、揮發性(Volatility) 來看。

### Main memory

儲存這邊最重要的一個分隔點就是主記憶體，主記憶體是 cpu 能直接訪問的最後一層了，它上面可以有很多層，像是 register、cache，看妳怎麼設計，但這些都只是 copy 而已，最後這些資料還是已主記憶體上的資料為主。

它主要的技術就是 Random Access Memory(RAM)，可以分為兩種：

1. DRAM (Dynamic RAM)
    
    + 只需要一個 transistor
    
    + 需要的 power 比較少
    
    + 速度比較慢，也就是一般的 main memory
    
    + access 的速度大概 >= 30 ns
    
        這個主要是 access memory 的 bus 的差別，所以買的時候才會有 DDR 幾，memory bus 是什麼的差別。
        
        因為電腦有很多的 core，大家都搶著來這裡讀資料，所以就會有不同的 protocol，不同的方式去把 channel 打開，就會影響到速度，而 RAM 的速度大概就是那樣，沒差很多。
    
2. SRAM (Static RAM)

    + 需要 6 個 transistor

    + 需要較多的 power

    + access 的速度大概在 10ns ~ 30ns 間

    + 通常用在 cache memory

另外 RAM 有一個特性就是讀取任何位置的資料，時間都是一樣的，後面會講到 Disk，就不是這樣的了。

大部分的這些 solution 都有 trade-off，畢竟如果有一個完美的方案那就不用再去分這兩個了，而上面這些只是大概提一下，不用特別去記，畢竟比較跟 OS 無關。

### Secondary Storage

而主記憶體以下的統稱為 Secondary Storage，如果妳想讓 cpu 讀它，必須要先把它搬到主記憶體才能讀，所以會比較慢。

所以 Real time 的系統不會有 Secondary Storage，不然還要在那邊搬移，太花時間了，它需要立刻就可以 access。

通常 Secondary Storage 的容量會比較大，且是 nonvolatile 的，也就是說斷電後資料還會存著，不會消失。

常見的就是 HDD 和 SSD 那些的。

這邊看一下 Disk，他不是電子式而是機械式的，它會有讀寫的手臂，手臂上面有很多磁頭可以同時讀寫多個磁盤，磁盤有很多個，可以旋轉：

![Disk_Mechanism](https://github.com/Mes0903/Mes_Note/blob/main/Operating_System/Ch1_Introduction/Image/Disk_Mechanism.png?raw=true)

所以可以看見讀取的速度和資料在哪裡就有關係了，如果資料剛好在磁頭的對面，妳就需要轉半圈才會讀到，這樣就會有多一個 access 的時間。

而 SSD 就是電子式的，且讀取速度與資料在哪裡也沒什麼關係，所以速度才會比較快，但如果是讀取連續的資料，那 SSD 與 HDD 其實不會差太多，SSD 是贏在資料跳來跳去的狀況。

### Caching

而電腦的資料通常最終會儲存在最慢的 Device 裡面，因此我們會把資料 copy 到比較快的 Device 上面，用到的頻率越高，我們就會把它存到越上層，所以才會需要有 L1、L2、L3 的 Cache，加速 cpu 的計算：

![Caching](https://github.com/Mes0903/Mes_Note/blob/main/Operating_System/Ch1_Introduction/Image/Caching.png?raw=true)

注意是 copy，不是搬移，如果是搬移，我們不稱它為 Cache。且 Copy 過去的資料是暫時性的資料，我們可以隨時砍掉它且不應該造成儲存資料的遺失。

所以 cpu 要資料時會先去 register 找，沒有的話再往下一層找；但讀回來的時候會被 Cache 住，所以會需要 cpoy 它，因此會比沒有 Cache 還慢。

主要的想法就是把常用的東西先存起來，如果只單看一次，有 Cache 機制會比較慢，因為還要一層一層檢查，然後還要 copy 資料，但一旦 Cache 好後再去使用這個資料就會非常快。

也因此有些系統是沒有 Cache 的，看妳怎麼設計，一個例子是處理巨量資料的系統，因為資料量非常大，所以一定是掃過一遍就丟掉，不可能在這邊來來回回檢查，且資料很有可能大到 memory 都塞不下，這種狀況下 Cache 就沒意義了。

### Coherency and Consistency Issue

Cache 的定義是 Copy，只是個分身，不能跟本尊不同，如果不同，就會有 Coherency 的問題，也就是不一致性。

所謂的不一致性指的是如果我們 copy 到上層後對上層的資料做了修改，像是對 Cache 的資料做了修改但還沒更新 memory 那邊的資料，這時候兩邊的資料內容就不一樣。

這種情況其實沒關係，妳只需要保證電腦使用者看到的都是最上層，最新的資料內容就可以了，重點就是讓 user 看到一致的資料內容。

因此如果今天妳的 Data 只有被一個 Process 訪問，那其實不會有什麼問題，妳再慢更新後面的資料也沒關係；但如果今天有很多個 Process 在 share 同一段 memory content，那就會有問題了，在分散式系統裡面這也是一個很重要的議題，因為還牽扯到了網路。

## Hardware Protection

Protection 指的不是 Security，而是指很多程式、使用者同時在使用電腦時不會影響到對方，像是如果 A 程式 crash 了，B 程式應該也要能繼續跑；或是指某個程式只能使用某段 memory content，不能不通過 OS 就去使用到別人的 memory，諸如此類的。

### Dual-Mode Operation

前面在講的時候都有把 OS 與 User 分開，有些動作只有 OS 能做，那要怎麼區分 User 與 OS? 在最底層，Hardware 必須進來，因為 Hardware 是很難被修改，東西已經燒在上面的，所以 Hardware 可以做一些最基本的 Protection。

而 Software 利用 Hardware support 來做一些事情，所以 Software 方面至少會有兩種 mode：

1. User mode

    來自於 OS 以外的 Program 都屬於 User mode
    
2. Monitor mode (kernel mode)

    來自於 OS 的 Program，在這個 mode 下執行的程式一定是 OS 的程式碼，但可能是使用者透過 system call 來讓 OS 做的。

這兩個 mode 在可能就是一個 bit(0 or 1)，我們前面提過，OS 要做任何事都是透過 system call，而 system call 需要透過 Interrupt。

<center><img src="https://github.com/Mes0903/Mes_Note/blob/main/Operating_System/Ch1_Introduction/Image/Dual_mode.png?raw=true"></center><br>

平常某個 Program 在執行時是在 User mode 底下，而當它送 Interrupt 出來後那個 bit 就會 flip，進到 kernel mode，因為只要一發 Interrupt 就代表你 call 了 system call，而 system call 就會執行 OS 的程式。

因此 Interrupt 還有一個很重要的意義就是 Program 會從 User mode 切換到 Kernel mode，等到 OS 做完，return 到 User Program 時，那個 bit 才會 flip 回來。

### Privileged instructions

那我們就可以透過這個機制來保護電腦，今天我們要做任何事都要透過 instruction，如果某個 instruction 會影響到其他人，我們就會要求他一定要透過 OS，這個是 instruction 在設計的時候就寫死的，也就是它有一個 set 叫做 Privileged instructions。

所謂的 Privileged instructions 必須在 kernel mode 才能執行，你 User 也可以送這個 instruction 給 cpu，但 cpu 在執行的時候會去 check 前面提到的那個 bit，而當 cpu 看到你現在那個 bit 代表的是 User mode，它就不會繼續執行，直接丟一個 error 出來讓 OS 處理。

所以 User 需要透過 system call 才能讓 OS 幫忙做事，這樣 OS 就可以完全 control 哪些動作能做哪寫不能。

### I/O Protection

那接下來我們就要看怎麼去保護電腦，首先是 I/O 方面，而與 I/O 有關的 instruction <span class = "yellow">全都都需要保護</span>，因為 I/O 的資源是 share 的，像是螢幕輸出，都時同一個螢幕，硬碟儲存也是同一顆硬碟。 

如果沒有限制需要 kernel mode 才能進行 I/O，那別人就可以亂更改你的 Device，整個系統就會亂掉。

但這樣其實還是有一些漏洞，沒法繞過 I/O，但還是可以繞 memory，像是透過合法的 I/O 流程去修改原本應該要執行的函式，讓它執行我們想要做的事這類的，有在打 CTF 的應該很熟。

### Memory Protection

所以更重要的還是保護 memory，首先當然 Interrupt vector 不能被改，然後就是別人的 Data 不能被修改這類的。

保護的方式其實很簡單，就是紀錄兩個 register，這樣就有一個區間給 memory 使用，超過這個區間的 memory 就不屬於這個 Process。

邏輯上這是一個連續空間，所以我們需要的兩個 register 分別為 Base register 與 Limit register，前者記錄開始的位置，後者記錄 memory 區間有多長。

檢查的流程大概就長這樣：

<center><img src = "https://github.com/Mes0903/Mes_Note/blob/main/Operating_System/Ch1_Introduction/Image/memory_protection.png?raw=true"></center>

先去檢查存取的 address 有沒有大於 base address，再去看有沒有小於 base address + limit，都通過慈可以存取 memory。

要注意的是 Base register 與 Limit register 都是 register，裡面存的都是值，如果要修改這個值，這個 instruction 需要是 Privileged instructions，不然這個機制也沒用了。

### CPU Protection

cpu 的保護主要是要阻止一個程式可以霸佔 cpu，不讓別的程式執行，舉個例子，當我們有一個 Process 裡面有無限迴圈，我們一樣可以把它 ctrl+c 掉，不會 cpu 直接被霸佔，電腦整個當掉。

而主要的方法叫做 Time sharing，會有一個 Timer 來計時，每過一段時間就會丟一個 Interrupt 出來，把原本的 Process 打斷，執行 OS 的 Scheduler，這樣每過一段時間控制權就會回到 OS，OS 再決定是不是要繼續剛剛那個 Process。

而那個 Load time 到 register 的 instruction 也是 privileged instruction，只有 OS 可以調整 Timer 數的時間。

第一章就到這裡，簡單介紹了整個 OS，下一章會開始進到 OS Structure。

