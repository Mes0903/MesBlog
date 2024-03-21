---
title: Ch3 Processes Concept
date: 2022/2/6
abstract: 簡單介紹了 Process
tags: OS
categories:
- OS
---

# Ch3 Processes Concept

## Process Concept

前面一直看到 Process 和 Program，他們翻成中文都叫程式，但他們是有一些差別的，Program 是一堆儲存在 disk 裡面的 binary，它是死的東西，只是個檔案，等著被執行，簡單來講就是程式碼而已。而 Process 就是跑起來的 Program，在 memory 裡面，因為正在被執行，是活的。

一個 Process 會有一個 memory space，裡面會有一些主要的 content：

+ Code segment (text section)
    
    簡單來說就是你的程式碼，原本這些是儲存在 disk 裡面的，但當 Process 要執行時 OS 會把你的 code load 到 memory 裡面，等著被 CPU fetch 進去 instruction。
    
    所以當然這些 code 就不是一般的 code，而是 instruction 了，因為要直接送到 CPU 裡去了。

+ Data section

    全域變數儲存的地方，Process 一開始就存在，所有的 function 都可以 access。

+ Stack

    local 變數儲存的地方，function call 完後就會消失了。
    
+ Heap

    dynamic allocated 的變數儲存的地方。

+ Current activity

    一些 metadata，拿來管理 Process 用的，像是 program counter，register contents 等等
    
+ 一些相關的 resources

    在開檔，使用電腦上的資源時，Process 會需要一個類似 token 的東西，讓 OS 能夠知道你開了哪些檔案，或是用了多少 socket port 等等。

## Process in Memory

所以我們常說一個 Process 在 OS 的世界裡就是一個 memory 的 space，基本長的會像這樣：

![](https://i.imgur.com/FalUQpT.png)

但這只是個例子，每個作業系統的管理方式可能會有些不同。

heap 和 stack 的大小是會隨 Process 執行而變化的，而 data 段和 code 段則是固定的。

## Thread

另一個你可能很常聽到的東西是 thread，thread 和 process 很相似，但也有一些地方不一樣。

Thread 有另外一個名字叫 lightweight processs，因為它的管理方式跟 process 很像，但很多 thread 是可以共用一些 memory 的，像是之前我們說 shared memory 的溝通我們用 shared programming，因為它本身就有一塊 memory 在預設上是共用的。

在建立一個 thread 的時候，這些共用的空間就不用在重複建立了，因為在形成這些 thread 的 parent process 時就已經 allocate 好了，因此在管理上和 memory allocation 上就少了一些動作，我們才會說他是比較 lightweight 的。

同時，在運作的時候，電腦系統裡面最基本的單位其實是 thread，也就是說 CPU 在執行的單位是 thread，因為 Process 可以被切成很多個 thread，所以 thread 才是 CPU 執行的最小單位。

下圖可以看的更清楚 thread 和 Process 的差異，其實就在於說在同一個 Process 下的所有 thread，它們有些 memory 是共用的，定義上來說，只要是同一個 Process 下的 thread，它的 code section，data section 和 OS resources 是共用的，某一個 thread 開了一個檔案，另一個 thread 可以直接拿這個檔案的 pointer 跟著去做讀寫。

![](https://i.imgur.com/NCeLmMW.png)

但是可以看見 register、stack 等就沒有共用了，因為每一個 thread 執行的位置可以不一樣，甚至可以執行不同的 function call，所以執行的狀態也是獨立的。

因為要可以獨立執行，所以 thread 會有自己的 ID，program counter，register set 和 stack，讓 OS 知道它是 Process 裡的哪一個 thread。

## Process State

一個 Process 被 launch 起來後整個執行的過程主要會有五個狀態

+ New

    Process 被建立起來，這個狀態會做很多事情，要把 Program load 到 memory，把剛剛看到的記憶體配置分配好，並做初始化等等的動作。
    
    所以比較早期的電腦 memory 比較小，launch 太多 Process 時，可能會連 New 一個 Process 都會遇到困難，這樣在 New 的過程就會直接把這個 Process kill 掉。
    
+ Ready

    因為在電腦裡面資源需要去分配，Process 需要去競爭 CPU，所以 Process 被 allocate 完存在記憶體裡，等著使用 CPU 之前的狀態就是 Ready，Process 此時會被放到一個 queue 裡面等著 OS 做排程，此時 Process 可以立刻被執行。

+ Running

    當 Process 被選中，能夠送 instruction 進 CPU 執行時的狀態就是 Running。
    
+ Waiting

    一個 Process 執行的過程中不只會使用 CPU，可能還會去做 I/O 等等，此時就會進到 Waiting State

+ Terminated

    Process 執行完畢，所有資源會被釋放回去。

可以看下圖，更好記憶：

![](https://i.imgur.com/j3IftQs.png)

## Process Control Block (PCB)

上面的 Process State 是一個管理的邏輯，實現的方式是 OS 會幫 Process 建立一個 table，紀錄剛剛那些 information，這樣 OS 就可以知道誰在 Queue 裡面，誰的 State 是什麼等等：

![](https://i.imgur.com/DZ5idza.png)

PCB 是 OS 建立的一個物件，前面提到 Process 會被放到 Queue 裡面，這是一個抽象的概念，實際上是 PCB 被放到 Queue 裡面，實作的方法通常是 linked list，所以 PCB 裡面會有一個 pointer 指向下一個 PCB。

另外 PCB 裡面還會有 Process State，Program counter，CPU register 等資訊，這些東西是放在 memory 裡面，而且是 kernel space，是 OS 自己的 memory 裡面。

## Context Switch

前面有提到 Process 需要在 CPU 與 memory 間，與其它的 Process 交換，這動作有個專有名詞叫 Context Switch，這部分也是利用了 PCB 來完成。

我們前面有提到 Context Switch 會發生一定是因為有 interrupt 進來，或者是自己 call 了一個 system call，所以才會切換到其他的程式。

下面有張簡單的圖，假設 Process P0 是一開始在執行的，所有的東西都 load 到 CPU 的 register，然後有一個 interrupt 進來，所以 P0 就進了 idle，當 P0 要把 CPU 讓出來時，就需要做 Context Switch。

動作其實很單純，就是要把 CPU 裡面的 state 全部存到 P0 的 PCB 裡面，記完後再去執行 P1，P1 可能是 OS 或是別的 Process，為了讓它執行，需要把 P1 的 PCB 的資訊 load 到 CPU 的 register，此時的 P0 和 P1 都是在 idle 的。

Context Switch 完成後就會開始執行 P1，所以會把 program counter 設到該執行的位置，做 fetching 的動作。

下圖裡面 P1 執行完後又做了一次 Context Switch 回 P0，一樣的意思，會 save 和 reload PCB：

![](https://i.imgur.com/5YwZ5qJ.png)

簡單來說 Context Switch 就是在做 Process 的 load 和 save，但要注意 Context Switch 的時間是 overhead 的，也就是多餘的時間，上圖可以看見在做 Context Switch 時 P0 和 P1 都是在 idle 的，等於是在浪費 cpu cycle，純粹是為了管理與 sharing。

所以其實我們有時候應該要去避免 Context Switch

在實際的系統中，因為 Context Switch 無法避免，所以我們會希望盡量減少每次 Context Switch 所需要花費的時間

# Processing Scheduling

由於 memory 裡面會有很多 process 等著被執行，同時我們要實現 time sharing，因此這些 process 會需要輪流使用 CPU，而決定誰先用誰後用的動作就叫做 Scheduling

Process 在被 schedule 的過程中會被放在 OS 內部的 qeueu 裡面，他們分別是

+ Job queue
    + New State
    + 放要從 Program 進到被 launch 狀態的 Program
    + 較早期的 OS 才有
+ Ready queue
    + Ready State
    + 放 main memory 內所有等待使用 CPU 的 Process
+ Device queue
    + Wait State
    + 放等著做 I/O 或 sleep 等等的 Process

![](https://hackmd.io/_uploads/rJGYRCtep.png)

上圖中最上面的是 Ready queue，而 I/O 的 Waiting queue 通常會有很多個，看你是哪個 device 就去那裏排；Ready queue 也不一定只有一個，可能會有 level1、level2、level3 之類的 Ready queue

所以整體流程會類似下圖，最上面有個 ready queue，而下方有四個 Waiting queue：

![](https://hackmd.io/_uploads/rypUyk5x6.png)

## Scheduler

 Scheduler 是負責幫忙做 scheduling 的 process，依照場合可將其分為三類，也可以對應到上方的三個 queue：
 
+ short-term scheduler
    + 將 process 從 memory 拉到 CPU 執行
    + 操作很頻繁所以叫 short-term
    + Ready State \-\> Run State
    + 很注重效率
+ Long-term scheduler
    + 選擇要被 load 到 memory，將其設為 Ready State 的 Process
    + New State \-\> Ready State
    + 決定可以有多少 Process 在 memory 內
        + 太少的話 CPU 會 idle，太多的話 CPU 會有 thrashing 發生
    + 近代的 OS 可能沒有(由於近代 memory 比以前大很多)
        + ex. UNIX/NT 沒有 long-term scheduler
        + 一些 long term running machine 可能還有，但我們的電腦一般不是(Process 執行時間很短，或是通常就放著 idle)
+ Medium-term sheduler
    + 選擇要被 swap 回 Disk，或是要從 Disk swap 回 memory 的 Process
    + Ready State \-\> Wait State
    + 目的是用來平衡 CPU 和 I/O 的使用率，還有控制記憶體的使用量
    + 後面讀完 memory 的部分後會比較好理解
    + 現代的 OS 沒有 medium-term scheduler，工作內容由 Vitrual memory 機制代替

# Process Creation

## PID
 
Process 在 OS 中是一個實體，要找到他 我們就需要給 Process 一個 id，這個 id 我們稱之為 pid
 
Process 要產生需要被 Parent create，所以我們一定可以把 Process 畫成一個 Tree：

![](https://hackmd.io/_uploads/S1KETR5lT.png)

## Process Creation

Parent 和 Child Process 會有一定的關聯性，但實際上有什麼樣的關聯性是交由 OS 設計者來決定的

### fork

在 UNIX/Linux 中，要創建一個 Process，我們需要使用 `fork` 這個 system call，被 fork 出來的 child 的記憶體配置一開始會和 parent process 一模一樣

parent 與 child process 是 concurrently 執行的，也就是說 parent 不需要等 child 執行完才能接著執行

fork 會有一個 return value，child 與 parent 的唯一差別在於這個 return 的 value 會不一樣，child 的 return value 為 `0`，而 parent 的 return value 為他的 `pid`，但要注意 child 一樣有自己的 pid

fork 完之後我們可以使用 `execlp` 這個 system call 來把你要執行的 binary file 塞進你的 child process 的 memory，把原本的 memory 內容洗掉，這樣就可以執行你要的 code 了

而如果我們想要等待某個 Process 執行結束後才繼續執行，我們可以使用 `wait` 這個 system call，把 Process 放到 waiting queue 裡面

可以簡單看一下 `fork` 用起來的樣子：

```cpp
#include <stdio.h>
#include <sys/types.h>
int main()
{
  fork();
  fork();
  fork();
  printf("hello\n");
  return 0;
}
```

輸出：

```
hello
hello
hello
hello
hello
hello
hello
hello
```

```c
fork();   // Line 1
fork();   // Line 2
fork();   // Line 3
	
      L1        // There will be 1 child process 
    /    \      // created by line 1.
  L2      L2    // There will be 2 child processes
 /  \    /  \   // created by line 2
L3  L3  L3  L3  // There will be 4 child processes 
                // created by line 3
```
    
從這個圖你可以看出來總共有 8 個 process 執行了

# Interprocess Communication(IPC)

現在我們會創建 Process 了，接下來會需要的就是 Process 內的溝通，簡稱為 IPC，之前有講過主要有兩種方式，Shared memory 與 Message Passing

![](https://i.imgur.com/UxK49Kx.png)

Shared memory 的優點是快，透過 memory address 來 access data，但缺點就是要處理 Synchronization 的問題; Message Passing 就反過來，比較慢，但不用處理 Synchronization，在某些情況下用 Message Passing，因為不用處理 Synchronization，所以反而會比較快

一般來說，在同一台電腦上，溝通的 Process 多，情況複雜，我們就會使用 Message Passing，如果溝通的 Process 少，Communication Pattern 比較簡單，我們就會使用 Shared Memory，

## Shared Memory

主要是用 Thread Porgramming 的方式在寫，因此條件很單純，因為就是 memory access，唯一的條件就是你要有辦法去創見一塊共用的記憶體出來，這件事情預設是不會有的，需要靠 system call 才能做到

另外 Shared Memory 需要處理 Synchronization 的問題，不能讓兩個 Process 同時寫一塊記憶體，可以看一個知名的例子

### Consumer & Producer Problem

Producer 是一個 Process 負責產生 data，而 Consumer 是另一個 Process 負責消耗 data，所以有兩支不同的 Process，並會有一段共用的記憶體空間給這兩個 Process 放 data 與拿 data

考慮一個直觀的寫法(來源：[wiki](https://zh.wikipedia.org/zh-tw/%E7%94%9F%E4%BA%A7%E8%80%85%E6%B6%88%E8%B4%B9%E8%80%85%E9%97%AE%E9%A2%98))

```cpp
int itemCount = 0;

procedure producer() {
    while (true) {
        item = produceItem();
        if (itemCount == BUFFER_SIZE) {
            sleep();
        }
        putItemIntoBuffer(item);
        itemCount = itemCount + 1;
        if (itemCount == 1) {
            wakeup(consumer);
        }
    }
}

procedure consumer() {
    while (true) {
        if (itemCount == 0) {
            sleep();
        }
        item = removeItemFromBuffer();
        itemCount = itemCount - 1;
        if (itemCount == BUFFER_SIZE - 1) {
            wakeup(producer);
        }
        consumeItem(item);
    }
}
```
調用 sleep 的 Process 會被阻斷，進入睡眠狀態，直到有另一個 Process 用 wakeup 喚醒它

上面代碼中的問題在於它可能導致 race condition，假設 count 為 2，考慮下面的情況：

1. Producer 將 2 存入 register 並將其 + 1，因此 Producer 現在認為 count 的值為 3
2. Consumer 將 2 存入 register 並將其 - 1，因此 Consumer 現在認為 count 的值為 1

之後問題就來了，如果是 Producer 先將 count 的值寫回記憶體，之後 Consumer 再將 count 的值寫回記憶體，此時記憶體中 count 的值就為 1，反之則為 3

不管是哪種情況，你都會覺得怪怪的，原因就出在兩個 Process 同時在讀寫這塊記憶體，這種問題我們稱為 Synchronization Problem

因此我們需要特別處理這塊記憶體的使用，假設共用的記憶體空間是一個有 `B` 個元素的 circular array，我們有兩個指標 `in` 與 `out`，`in` 指向放入 data 的位置，`out` 指向拿出 data 的位置：

![](https://hackmd.io/_uploads/SJ7U3J2-a.png)

當 `in` 與 `out` 指向同一個地方的時候代表這個 array 現在是空的，當 `in+1` 模除 array size 指向的地方和 `out` 相同時表示這個 array 是滿的

我們可以簡單看一下 code:

![](https://hackmd.io/_uploads/r1cMRynbp.png)

在 Producer 中，當 array 是滿的時候，`while(((in + 1) % BUFFER_SIZE) == out) ;` 這個 while 迴圈會卡在那邊空轉，直到 Consumer 把東西拿走，讓 array 有空間，Producer 才會繼續放東西進去 array，注意這個 while 的後面有一個分號，這是因為 while loop 的後面需要接一個 statement

而在 Consumer 中，當 array 是空的時候，`while(in == out) ;` 這個 while 迴圈會卡在那邊空轉，直到 Producer 將東西放進 array，讓 array 內有東西，Consumser 才會把 array 內的東西拿出來

由於 `in` 與 `out` 都只會有一個 Process 在修改，因此就避免了同步的問題，這邊要注意一點是 `in` 與 `out` 必須是 `volatile` 的，這會保證每次使用 `in` 與 `out` 的變數時其都會重新從記憶體中讀值

我有實作一個 Demo 用的小程式，我是使用 semaphore 來處理 Synchronization Problem，你可以在這個[連結](https://www.youtube.com/watch?v=I1nM207KStg)內看到我的錄影，底下說明欄有對應的 code，這是跑在 windows 上的，如果需要 unix 的版本，網路上應該蠻多的

## Message Passing

要使用 Message Passing，首先我們要建立一個管道，這可以是一個 Hardware bus，或是網路，甚至是一塊 shared memory 都可以，因為這是一個機制，你只要有管道能讓你溝通就可以

溝通的時候可以簡單分為兩種方式：Direct 與 Indirect，Direct communication 表示在溝通前要先指定要和誰溝通，類似我們在打電話一樣，好處是 link 的關係較清晰，都是 One-to-One 的

用這個方法來處理剛剛的 Producer Consumer Problem 就會變得很簡單：

```cpp
// producer
while(1) {
    send(consumer, nextProduced);
}

// consumer
while(1) {
    receive(producer, nextConsumed);
}
```

在 Producer 呼叫 `send` 時，會需要等到 Consumer 端呼叫 `receive`，它才可以繼續執行下一行

這樣會等待對方回應的訊息傳遞方式我們稱為 Blocking，又稱 synchronous，相反的，如果 `send` 呼叫完後不會去等對方，則稱為 non-Blocking，又稱為 asynchronous

要注意，`send` 與 `receive` 不一定要統一使用某種方法，可以其中一端為 Blocking，另一端為 non-Blocking 的

Indirect Communication 則是像在信箱放信一樣，發送端會把訊息放到一個 mailbox 裡面，而接收端需要自己去 mailbox 拿訊息，接收端不需要知道是誰發過來的，而且可以多對多，大家都到這個 mailbox 裡面拿訊息

