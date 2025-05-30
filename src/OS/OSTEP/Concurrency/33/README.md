---
title: OSTEP 33：Event-based Concurrency
date: 2025-05-31
tag: 
- OS
- OSTEP
category: OS
---

# OSTEP 33：Event-based Concurrency

迄今我們在討論並行時，彷彿並行應用程式唯一的實現方式就是使用執行緒。 如同人生中許多事物，這並不完全正確。 具體來說，一種不同風格的並行程式設計經常被應用在 GUI 應用程式 [O96] 以及某些類型的網路伺服器 [PDZ99]。 這種風格稱為事件驅動並行，已在一些現代系統中流行，包括像 node.js [N13] 這類伺服器端框架，但它的根源可追溯到 C/UNIX 系統，下面我們將討論這些系統

事件驅動並行要解決的問題有兩個方面。 首先，在多執行緒應用程式中，正確管理並行可能非常具挑戰性。 如我們先前所述，Deadlock 以及其他棘手問題都可能出現。 其次，在多執行緒應用程式中，開發者幾乎無法控制系統在任何時刻的排程。 程式設計師只能建立執行緒，然後期望底層 OS 能在可用的 CPU 核心間以合理方式排程。 考量要構建一個適用於所有工作負載並在各種情況下都表現良好的通用排程器之困難，有時 OS 的排程結果並不理想

:::info  
如何在不使用執行緒的情況下建構並行伺服器

我們如何在不使用執行緒的情況下建構並行伺服器，以便掌控並行機制並避免那些困擾多執行緒應用程式的問題？  
:::

## 33.1 The Basic Idea: An Event Loop

我們將採用的基本方法，如前所述，稱為事件驅動並行。 這種方法非常簡單：只需等待某件事（即「事件」）發生； 當它發生時，檢查事件的類型，再執行所需的少量工作（可能包含發出 I/O 請求或排程其他事件以便日後處理等）就可以了

在進入細節之前，讓我們先觀察典型的事件驅動伺服器長什麼樣子。 此類應用圍繞一個簡單的結構 —— 事件迴圈，來運作。 事件迴圈的偽程式碼如下：

```c
while (1) {
  events = getEvents();
  for (e in events)
    processEvent(e);
}
```

真的就是這麼簡單，主迴圈僅呼叫 `getEvents()` 等待有事可做，然後對每個回傳的事件逐一處理； 負責處理事件的程式碼被稱為事件處理器。 值得注意的是，當處理器在處理某個事件時，系統中只會剩下該事件在活動； 因此，決定下一個要處理的事件就等同於排程，這進而讓我們能夠對排程進行明確掌控，是事件驅動方法的基本優勢之一

但這段討論引出了更大的疑問：事件驅動伺服器究竟如何判斷哪些事件正在發生，特別是與網路及硬碟 I/O 有關的情況？ 更確切地說，事件伺服器如何得知有訊息已經抵達？

## 33.2 An Important API: `select()` (or `poll()`)

考量到上述基本的事件迴圈後，我們接著必須解決如何接收事件的問題。 在大多數系統中，都提供了一個基本的 API，可透過 `select()` 或 `poll()` 系統呼叫來使用

這些介面讓程式能做的事情很簡單：檢查是否有任何傳入的 I/O 需要處理。 例如，假設一個網路應用程式（如網頁伺服器）想要確認是否有網路封包已經抵達，以便進行服務。 以 `select()` 為例，在 Mac 的 man page 中，這個 API 如下：

```c
int select(int nfds,
           fd_set *restrict readfds,
           fd_set *restrict writefds,
           fd_set *restrict errorfds,
           struct timeval *restrict timeout);
```

實際上的 man page 描述如下：`select()` 檢查傳入 readfds、 writefds 和 errorfds 的 I/O 描述符（descriptor）集合，以驗證它們的描述符是否分別準備好可讀、可寫或處於異常狀態。 接著它對每個集合中的前 `nfds` 個描述符進行檢查，也就是檢查索引從 `0` 到 `nfds-1` 的那些描述符。 返回時，`select()` 會將傳入的描述符集合替換為「已準備好執行請求操作的描述符子集合」。 `select()` 本身則回傳所有集合中已就緒描述符的總數

關於 `select()` 有幾點要注意。 首先，它可讓您同時檢查描述符是否可讀或可寫，前者（可讀）能讓伺服器得知有新封包抵達並需要處理，後者（可寫）能讓服務知道何時可以回覆（也就是 outbound queue 還沒滿）

其次，要注意 `timeout` 參數。 一種常見做法是將 `timeout` 設為 `NULL`，這會使 `select()` 無限期阻塞，直到有描述符就緒。 不過更穩健的伺服器通常會指定某種超時機制，一個常見技巧是將 `timeout` 設為零，讓 `select()` 被呼叫時立刻回傳；而  `poll()` 系統呼叫的行為非常相似，詳情請參閱其 man page 或 Stevens and Rago [SR05]

不管哪一種方式，這些基本原語提供了一種構建非阻塞事件迴圈的方法，該迴圈僅檢查傳入封包、讀取帶有訊息的 socket，並在需要時回覆

:::info  
阻塞介面與非阻塞（non-blocking）介面

阻塞（或同步）介面會在回傳給呼叫者前完成所有工作，非阻塞（或非同步）介面則開始部分工作後立即回傳，讓需要完成的工作在背景執行。 阻塞呼叫的元凶通常是某種 I/O 操作，例如，如果一個呼叫必須從硬碟讀取以完成，它可能會因為等待已送往硬碟的 I/O 請求回傳而發生阻塞

非阻塞介面可用於任何程式設計樣式（例如使用執行緒），但在事件驅動方法中是必要的，因為任何阻塞呼叫都會停止所有進度  
:::

## 33.3 Using `select()`

為了更具體地說明，我們來檢視如何使用 `select()` 來查看哪些網路 descriptor 上有傳入的訊息。 圖 33.1 是一個簡單的範例

<div class = "center-column">

```c
#include <stdio.h>
#include <stdlib.h>
#include <sys/time.h>
#include <sys/types.h>
#include <unistd.h>

int main(void)
{
  // open and set up a bunch of sockets (not shown)
  // main loop
  while (1) {
    // initialize the fd_set to all zero
    fd_set readFDs;
    FD_ZERO(&readFDs);

    // now set the bits for the descriptors
    // this server is interested in
    // (for simplicity, all of them from min to max)
    int fd;
    for (fd = minFD; fd < maxFD; fd++)
      FD_SET(fd, &readFDs);

    // do the select
    int rc = select(maxFD + 1, &readFDs, NULL, NULL, NULL);

    // check which actually have data using FD_ISSET()
    int fd;
    for (fd = minFD; fd < maxFD; fd++)
      if (FD_ISSET(fd, &readFDs))
        processFD(fd);
  }
}
```

（Figure 33.1: Simple Code Using `select()`）

</div>

這段程式碼其實相當容易理解，完成初始化後，伺服器進入一個無限迴圈。 在迴圈內，它先呼叫 `FD_ZERO()` 巨集清除 descriptor 集合，然後再用 `FD_SET()` 將自 `minFD` 到 `maxFD` 的所有 descriptor 加入集合。 這組 descriptor 可能代表像是伺服器正在監控的所有網路 socket。 最後，伺服器呼叫 `select()` 來檢查哪些連線上有可用資料。 接著透過在迴圈中使用 `FD_ISSET()`，事件伺服器即可得知哪些 descriptor 已就緒並處理傳入的資料

當然，真正的伺服器會比這更複雜，並需要在傳送訊息、執行硬碟 I/O 以及其他許多細節時加入相應邏輯。 如需更多資訊，可參考 Stevens and Rago [SR05] 以獲得 API 資訊，或參閱 Pai 等人與 Welsh 等人的研究，了解事件驅動伺服器一般流程概覽 [PDZ99, WCB01]

:::info  
在事件驅動伺服器中請勿造成阻塞

事件驅動伺服器可讓您對任務排程進行細粒度的控制； 然而，為了維持此控制，任何會阻塞呼叫者執行的呼叫都不可使用，否則將導致整個事件驅動伺服器停擺  
:::

## 33.4 Why Simpler? No Locks Needed

在單一 CPU 與事件驅動應用程式的情況下，並行程式中常見的問題不再存在。 具體來說，由於一次只處理一個事件，就不需要取得或釋放 lock。 事件驅動伺服器不會被其他執行緒中斷，因為它確實是單一執行緒的。 因此，在基本事件驅動方法中，不會出現執行緒程式中常見的並行錯誤

## 33.5 A Problem: Blocking System Calls

迄今為止，事件驅動程式聽起來很棒，對吧？ 你只需撰寫一個簡單的迴圈，並在事件發生時加以處理。 你甚至不需要考慮加鎖！ 但有個問題：如果某個事件需要呼叫可能造成阻塞的系統呼叫該怎麼辦

例如，假設來自客戶端的請求進入伺服器，要從硬碟讀取檔案並將其內容回傳給請求端（類似於簡單的 HTTP 請求）。 為了處理此類請求，有些事件處理程式最終必須呼叫 `open()` 系統呼叫以開啟檔案，接著透過一系列的 `read()` 呼叫讀取檔案。 當檔案被讀取到記憶體後，伺服器很可能會開始將結果傳送給客戶端。 `open()` 和 `read()` 呼叫都可能向儲存系統發出 I/O 請求（當所需的 metadata 或資料尚未載入記憶體時），因此可能需要花費很長時間才能完成

使用執行緒驅動的伺服器時，這不成問題：當執行 I/O 請求的執行緒被掛起（等待 I/O 完成）時，其他執行緒可以繼續運作，從而使伺服器得以持續運行。 事實上，I/O 與其他運算的自然重疊正是執行緒程式設計的直觀且簡單之處

然而，採用事件驅動方法時，沒有其他執行緒可供運行：只有主要的事件迴圈。 而這意味著，如果事件處理程式發出會阻塞的呼叫，整個伺服器就會如此：阻塞直到該呼叫完成。 當事件迴圈阻塞時，系統將處於閒置狀態，因而造成大量資源浪費。 因此，在事件驅動系統中必須遵守一項規則：不可使用任何阻塞呼叫

## 33.6 A Solution: Asynchronous I/O

為了克服此限制，許多現代作業系統引入了一種統稱為非同步 I/O 的新機制，讓應用程式可以發出 I/O 請求後立即將控制權交還給呼叫者，而無需等到 I/O 完成。 另有介面可讓應用程式判斷多重 I/O 是否已完成，例如，我們來看看 macOS 所提供的介面（其他系統也有類似 API）。 這些 API 以 `struct aiocb`（通常稱為 AIO 控制區塊）為核心。 簡化後的結構如下（詳情請參閱 man page）：

```c
struct aiocb {  
  int aio_fildes; // File descriptor  
  off_t aio_offset; // File offset  
  volatile void *aio_buf; // Location of buffer  
  size_t aio_nbytes; // Length of transfer  
};  
```

若要對檔案執行非同步讀取，應用程式首先要填入此結構：包括要讀取檔案的描述符（`aio_fildes`）、檔案中的偏移量（`aio_offset`）、請求長度（`aio_nbytes`），以及最終要存放讀取結果的記憶體位置（`aio_buf`）。 完成填寫後，應用程式必須呼叫非同步讀取 API：

```c
int aio_read(struct aiocb *aiocbp);  
```

此呼叫嘗試發出 I/O，若成功便立即回傳，讓應用程式（即事件驅動伺服器）可繼續其工作。 接下來，我們還要解決一個問題：如何得知 I/O 已完成，並確認 `aio_buf` 指向的緩衝區已取得所需資料？ 此時，我們需要使用另一個 API，在 macOS 上，此函式名稱為 `aio_error()`，定義如下：

```c
int aio_error(const struct aiocb *aiocbp);  
```

此系統呼叫檢查 `aiocbp` 所指請求是否已完成，若完成則回傳 0 表示成功； 否則回傳 `EINPROGRESS`。 因此，對於所有尚未完成的非同步 I/O，應用程式可定期呼叫 `aio_error()` 以判斷該 I/O 是否已完畢

你可能已注意到，不斷檢查 I/O 是否完成十分麻煩； 當程式在同一時間發出數十或數百個 I/O 請求時，到底該不停地輪詢每個請求，還是先暫停一下再檢查，或……？ 為了解決此問題，部分系統採用中斷機制，透過 UNIX signal 在非同步 I/O 完成時通知應用程式，從而免除重複查詢系統的需求。 此輪詢與中斷之爭題在裝置章節也會看到（或你可能已經看到了）

在不支援非同步 I/O 的系統中，無法實現純粹的事件驅動模式； 不過，研究人員想出了一些相當有效的方法來替代。 例如，Pai 等人 [PDZ99] 提出一種混合方式：使用事件處理網路封包，並透過執行緒池管理尚未完成的 I/O。 有興趣可詳讀該論文了解細節

## 33.7 Another Problem: State Management

另一個事件驅動方法的問題是，這類程式碼相比傳統的執行緒驅動程式碼通常更難撰寫。 原因如下：當事件處理程式發出非同步 I/O 時，它必須打包一些程式狀態，以便在 I/O 最終完成時供下一個事件處理程式使用。 這項額外工作在執行緒驅動程式中不需要，因為程式所需的狀態已存在該執行緒的堆疊上。 Adya 等人將這項工作稱為手動堆疊管理，且它是事件驅動程式設計的基礎[A+02]

為了更具體說明，我們來看一個簡單範例：執行緒驅動的伺服器需要從檔案描述符（`fd`）讀取資料，讀取完成後，再將讀到的資料寫入網路 socket 描述符（`sd`）。 程式碼（忽略錯誤檢查）如下：

```c
int rc = read(fd, buffer, size)
rc = write(sd, buffer, size)
```

如你所見，在多執行緒程式中，這類工作非常簡單； 當 `read()` 最終返回時，程式立刻知道要寫入哪個 socket，因為該資訊已存在執行緒的堆疊變數 sd 上

在事件驅動系統中，情況就沒有那麼容易了。 要完成相同任務，我們首先會使用前述 AIO 呼叫以非同步方式發出讀取請求。 假設接著我們透過 `aio_error()` 週期性檢查讀取是否完成；當該呼叫告知讀取已完成時，事件驅動伺服器該如何得知接下來要執行什麼？

## 33.8 What Is Still Difficult With Events

還有一些其他事件驅動方法的困難值得一提。 例如，當系統從單一 CPU 轉向多 CPU 時，事件驅動方法的部分簡易性不復存在。 具體而言，為了使用多於一顆 CPU，事件伺服器必須同時執行多個事件處理程式； 如此一來，就會出現常見的同步問題（例如 critical sections），必須採用慣用解法（例如 locks）。 因此，在現代多核心系統上，不加鎖的簡單事件處理已不再可行

另一個事件驅動方法的問題是，它與某些系統活動（例如 paging）整合不佳。 例如，若事件處理程式發生 page fault，則會阻塞，因而伺服器無法繼續運作直到 page fault 完成。 儘管伺服器架構已避免明確的阻塞，但由 page fault 引起的隱性阻塞難以避免，若頻繁發生便會導致嚴重的效能問題

第三個問題是，隨著時間推移，各種 routine 的精確語意可能改變，事件驅動程式碼難以維護[A+02]。 例如，若某個 routine 從 non-blocking 改為 blocking，呼叫該 routine 的事件處理程式也必須做出調整，將自身拆分成兩段。 由於 blocking 對事件驅動伺服器而言極為致命，程式設計師必須時刻留意各事件所使用 API 的語意變動

最後，走了很長一段路後[PDZ99]，大多數平台現已支援 asynchronous disk I/O 了，但它與 asynchronous network I/O 的整合卻始終不如想像中那般簡單統一。 例如，雖然理想上可僅使用 `select()` 介面來管理所有待處理 I/O，但通常仍須將 `select()`（用於網路）與 AIO 呼叫（用於硬碟 I/O）結合使用

## 33.9 Summary

我們介紹了一種基於事件的簡易並行模型。 事件驅動伺服器將排程控制權交給應用程式本身，但代價是程式複雜度提升，且與現代系統其他面向（例如 paging）的整合更為困難。 因此，現在尚無單一方法能被視為最佳解； threads 與 events 兩種方法很可能在未來多年內並存，作為解決相同並行問題的不同途徑。 建議閱讀相關論文（例如 [A+02, PDZ99, vB+03, WCB01]），或更實際地，撰寫一些事件驅動程式碼以深入瞭解

## References

- [A+02] “Cooperative Task Management Without Manual Stack Management” by Atul Adya, Jon Howell, Marvin Theimer, William J. Bolosky, John R. Douceur. USENIX ATC ’02, Monterey, CA, June 2002  

  這篇論文首次清楚闡述事件驅動併發的種種困難，並提出簡單的解決方案；同時探索了將執行緒與事件兩種併發管理方式融合於同一應用中的大膽構想

- [FHK84] “Programming With Continuations” by Daniel P. Friedman, Christopher T. Haynes, Eugene E. Kohlbecker. In Program Transformation and Programming Environments, Springer Verlag, 1984  

  此篇論文是程式語言領域中關於 continuation（延續）的經典參考，對理解這一古老機制有不可或缺的價值

- [N13] “Node.js Documentation” by the folks who built node.js. Available: nodejs.org/api  

  Node.js 是眾多新興框架之一，能讓你迅速構建網路服務與應用。每位現代系統駭客都應精通此類框架（通常不只一種），投入開發並成為專家

- [O96] “Why Threads Are A Bad Idea (for most purposes)” by John Ousterhout. Invited Talk at USENIX ’96, San Diego, CA, January 1996  

  這場演講探討了執行緒在 GUI 應用程式（以及更廣泛場景）中的局限性。Ousterhout 在開發 Tcl/Tk 時累積的經驗，成為這些見解的基礎

- [PDZ99] “Flash: An Efficient and Portable Web Server” by Vivek S. Pai, Peter Druschel, Willy Zwaenepoel. USENIX ’99, Monterey, CA, June 1999  

  此先驅論文介紹了在網際網路初興時期如何構建高效可移植的網頁伺服器；閱讀它可理解基礎設計並學習在缺乏非同步 I/O 支援時的混合解法

- [SR05] “Advanced Programming in the UNIX Environment” by W. Richard Stevens and Stephen A. Rago. Addison-Wesley, 2005  

  這本書是 UNIX 系統程式設計的必備經典，任何細節問題幾乎都能在其中找到答案

- [vB+03] “Capriccio: Scalable Threads for Internet Services” by Rob von Behren, Jeremy Condit, Feng Zhou, George C. Necula, Eric Brewer. SOSP ’03, Lake George, New York, October 2003  

  本文探討如何在大規模網路服務中有效運用執行緒，以對抗當時大量出現的事件驅動方法

- [WCB01] “SEDA: An Architecture for Well-Conditioned, Scalable Internet Services” by Matt Welsh, David Culler, and Eric Brewer. SOSP ’01, Banff, Canada, October 2001  

  這篇論文提出結合執行緒、佇列與事件驅動處理的混合架構，為可擴展網路服務提供了新思路，其概念後續被 Google、Amazon 等公司採用
