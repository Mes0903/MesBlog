---
title: OSTEP 27：Thread API
date: 2025-05-29
tag: 
- OS
- OSTEP
category: OS
---

# OSTEP 27：Thread API

本章會簡要介紹 thread API 的主要部分。 接下來的章節會進一步解釋每個部分，並示範如何使用這些 API。 更詳細的資訊可以參考一些書籍與線上資源 [B89, B97, B+96, K+96]。 需要注意的是，後面的章節會以較慢的步調，搭配大量範例，來介紹 locks 與 condition variables 的觀念； 因此，本章更適合作為查詢用的參考資料

:::info  
如何建立與控制 threads

作業系統應該提供哪些介面來讓我們建立與控制 thread？ 這些介面該如何設計，才能既好用又實用？  
:::

## 27.1 Thread Creation

要寫 multi-threaded 程式，第一件事就是必須能夠建立新的 thread，因此作業系統必須提供某種 thread 建立的介面。 在 POSIX 系統中，這很簡單：

```c
#include <pthread.h>
int
pthread_create(pthread_t            *thread,
               const pthread_attr_t *attr,
               void                 *(*start_routine)(void*),
               void                 *arg);
```

這個宣告看起來可能有點複雜（尤其如果你還沒用過 C 裡的函式指標的話），但其實不難理解。 它總共有四個參數：`thread`、`attr`、`start_routine` 和 `arg`。 第一個參數 `thread` 是一個指向 `pthread_t` 結構的指標； 這個結構代表我們之後用來與 `thread` 溝通的對象，因此我們必須傳入它給 `pthread_create()` 來進行初始化

第二個參數 `attr` 用來指定這個 `thread` 可能會有的屬性。 例如你可以透過它來設定 stack 大小，或指定 thread 的排程優先順序等資訊。 要使用這些屬性需要先呼叫 `pthread_attr_init()` 初始化，更多細節請參考手冊頁。 不過，在大多數情況下，預設值就足夠了，所以我們通常直接傳入 `NULL`

第三個參數最複雜，但實際上只是指定：這個 `thread` 建立後應該從哪個函式開始執行？ 在 C 裡我們用函式指標來表達這種事情，這裡的函式指標 `start_routine` 表示這個函式的簽名應該是：傳入一個 `void *` 型別的參數，並回傳一個 `void *` 的值（也就是 void 指標）

如果你希望這個函式接收的是一個 `int` 而不是 `void *`，那麼 `pthread_create` 的宣告就會長這樣：

```c
int pthread_create(..., // first two args are the same
                   void *(*start_routine)(int),
                   int  arg);
```

如果這個函式改成接收 `void *`，但回傳的是 `int`，那宣告會是這樣：

```c
int pthread_create(..., // first two args are the same
                   int  (*start_routine)(void *),
                   void *arg);
```

最後一個參數 `arg` 就是傳遞給 thread 開始執行時所指定函式的參數。 你可能會問：為什麼要用 `void *`？ 其實很簡單：用 `void *` 作為參數類型，代表你可以傳入任意型別的資料； 而回傳值是 `void *` 也意味著這個 thread 可以回傳任何型別的結果

請看圖 27.1 的範例：

```c
#include <stdio.h>
#include <pthread.h>

typedef struct {
  int a;
  int b;
} myarg_t;

void *mythread(void *arg) {
  myarg_t *args = (myarg_t *) arg;
  printf("%d %d\n", args->a, args->b);
  return NULL;
}

int main(int argc, char *argv[]) {
  pthread_t p;
  myarg_t args = { 10, 20 };

  int rc = pthread_create(&p, NULL, mythread, &args);
  ...
}
```

<div class = "center-column">

（Figure 27.1: Creating a Thread）

</div>

我們建立一個 thread，並傳入兩個參數，這兩個參數會先打包成我們自定義的型別 `myarg_t`。 thread 建立後，就可以將傳進來的指標轉型成它所期待的型別，接著從中解包參數

就這樣，一旦你建立了 thread，它就變成了一個真正獨立執行的實體，擁有自己的 call stack，並與其他現存 threads 一起運行在同一個 address space 裡

## 27.2 Thread Completion

上面那個範例說明了如何建立一個 thread。 不過，如果你想要等待某個 thread 執行完該怎麼辦呢？ 這時你需要額外做些事情來等待它結束； 具體來說，你必須呼叫 `pthread_join()` 這個函式：

```c
int pthread_join(pthread_t thread, void **value_ptr);
```

這個函式有兩個參數。 第一個是 `pthread_t` 型別，用來指定你要等哪一個 thread。 這個變數是在建立 thread 時由 `pthread_create()` 初始化的（你會傳一個指標進去）； 只要你保留這個變數，就可以用它來等待對應的 thread 結束

第二個參數是指向回傳值的指標，也就是你期望接收的結果。 由於 thread 可以回傳任何東西，因此這個參數的型別是 `void *`。 而因為 `pthread_join()` 會修改這個參數的內容，所以你必須傳「指向該值的指標」，而不能直接傳該值本身

請看下圖 27.2 的另一個範例：

```c
typedef struct { int a; int b; } myarg_t;
typedef struct { int x; int y; } myret_t;

void *mythread(void *arg) {
  myret_t *rvals = Malloc(sizeof(myret_t));
  rvals->x = 1;
  rvals->y = 2;
  return (void *) rvals;
}

int main(int argc, char *argv[]) {
  pthread_t p;
  myret_t *rvals;
  myarg_t args = { 10, 20 };
  Pthread_create(&p, NULL, mythread, &args);
  Pthread_join(p, (void **) &rvals);
  printf("returned %d %d\n", rvals->x, rvals->y);
  free(rvals);
  return 0;
}
```

<div class = "center-column">

（Figure 27.2: Waiting for Thread Completion）

</div>

程式中再一次建立了一個 thread，並透過 `myarg_t` 結構傳入兩個參數。 若要傳回值，則使用 `myret_t` 結構。 一旦該 thread 執行完畢，main thread（此時正在 `pthread_join()` 裡等待）就會回來，接著我們就能取得該 thread 回傳的結果，也就是 `myret_t` 裡的內容

這裡有幾點要注意。 第一，實務上我們通常不需要這麼辛苦地包裝與解包參數。 比方說，如果 thread 不需要參數，我們建立它時直接傳 `NULL` 就好。 同樣地，如果我們不在意 thread 的回傳值，也可以在呼叫 `pthread_join()` 時傳入 `NULL`

第二，如果你只要傳一個單值（例如 `long long int`），那就不需要把它包進結構體。 圖 27.3 是一個範例，這種情況下會簡單一點，因為不必用結構體包裝參數與回傳值：

```c
void *mythread(void *arg) {
  long long int value = (long long int) arg;
  printf("%lld\n", value);
  return (void *) (value + 1);
}

int main(int argc, char *argv[]) {
  pthread_t p;
  long long int rvalue;
  Pthread_create(&p, NULL, mythread, (void *) 100);
  Pthread_join(p, (void **) &rvalue);
  printf("returned %lld\n", rvalue);
  return 0;
}
```

<div class = "center-column">

（Figure 27.3: Simpler Argument Passing to a Thread）

</div>

第三，我們必須特別注意 thread 回傳值的方式。 切記絕對不能回傳指向 thread 自己 stack 上變數的指標。 下面是從圖 27.2 修改而來的一段危險程式碼：

```c
void *mythread(void *arg) {
  myarg_t *args = (myarg_t *) arg;
  printf("%d %d\n", args->a, args->b);
  myret_t oops; // ALLOCATED ON STACK: BAD!
  oops.x = 1;
  oops.y = 2;
  return (void *) &oops;
}
```

在這段程式中，變數 `oops` 配置在 `mythread` 的 stack 上。 不過當 thread 結束時，該變數就會自動釋放（這也是 stack 好用的原因之一），因此你如果回傳一個指向這個已經失效的變數的指標，將會導致各種不可預期的錯誤。 當你印出以為正確回傳的值時，很可能會大吃一驚（但也不一定總是），試試看你就知道了！

最後你可能也注意到了，如果你用 `pthread_create()` 建立 thread，接著立刻呼叫 `pthread_join()` 來等它結束，這其實是種很奇怪的用法。 因為如果只是要執行某個函式，直接呼叫它（procedure call）不是更簡單嗎？ 顯然我們實務上通常會建立不只一個 thread，並等它們全部完成，否則根本沒必要使用 thread

值得一提的是，並非所有 multi-threaded 程式都會使用 join。 比方說，一個 multi-threaded 的 web server 可能會建立數個 worker threads，然後讓 main thread 持續接受 request 並分配給 workers 處理。 像這種長時間運行的程式通常就不會用 join。 不過，如果是那種用 thread 來平行執行特定任務的 parallel 程式，就很可能會使用 join，確保所有工作都做完之後再結束，或再進入下一階段的計算

## 27.3 Locks

除了建立 thread 和 join 之外，POSIX thread 函式庫中大概最實用的一組功能就是用來為 critical section 提供 mutual exclusion（互斥）的 lock。 最基本的兩個函式如下：

```c
int pthread_mutex_lock(pthread_mutex_t *mutex);
int pthread_mutex_unlock(pthread_mutex_t *mutex);
```

這兩個函式應該很直觀好用。 當你有一段程式碼是 critical section，因此需要受到保護以確保正確執行時，lock 就非常有用。 你應該能想像出程式碼會長這樣：

```c
pthread_mutex_t lock;
pthread_mutex_lock(&lock);
x = x + 1; // or whatever your critical section is
pthread_mutex_unlock(&lock);
```

這段程式碼的目的是：當某個 thread 呼叫 `pthread_mutex_lock()` 時，如果目前沒有其他 thread 持有該 lock，它就會成功取得 lock 並進入 critical section。 如果已有其他 thread 持有該 lock，那麼這個 thread 就會卡在 lock 呼叫的地方，直到它成功取得 lock（也就是原本持有 lock 的 thread 已經呼叫 unlock 釋放掉 lock）。 當然，可能會有很多 threads 一起卡在 lock 等待點，但只有那個真正取得 lock 的 thread 才應該呼叫 unlock

不過這段程式其實有兩個重要的錯誤。 第一個問題是沒有正確初始化 lock，所有的 lock 都必須先正確初始化，才能保證它們起始的值是正確的，這樣當你呼叫 lock/unlock 時才能如預期運作

在 POSIX threads 中，有兩種初始化 lock 的方法。 一種是使用 `PTHREAD_MUTEX_INITIALIZER` 這個巨集：

```c
pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
```

這樣會把 lock 設成預設值，使其可以正常使用。 另一種動態的初始化方式（也就是在執行階段）是呼叫 `pthread_mutex_init()`：

```c
int rc = pthread_mutex_init(&lock, NULL);
assert(rc == 0); // always check success!
```

這個函式的第一個參數是 lock 本身的位址，第二個參數是可選的屬性設定。 有興趣可以自己查閱這些屬性的用法，若傳入 NULL 就會使用預設值。 這兩種初始化方式都可以，但我們通常使用動態（也就是後者）方法。 當你不再需要這個 lock 時，也應該呼叫 `pthread_mutex_destroy()` 來釋放相關資源，詳細資訊請查閱手冊頁

這段程式碼的第二個問題是：它在呼叫 lock 和 unlock 時沒有檢查錯誤代碼。 就像你在 UNIX 系統中呼叫的幾乎所有函式一樣，這些函式也是可能失敗的！ 如果你沒檢查 return code，失敗就會默默發生，這在這種情況下可能會導致多個 thread 同時進入 critical section。 至少，你應該使用包裝函式來 assert 呼叫成功（就像圖 27.4 所示）； 如果是比較複雜（非玩具等級）的程式，不能單純出錯就 exit，那就應該檢查失敗狀態並採取適當的處理措施

```c
// Keeps code clean; only use if exit() OK upon failure
void Pthread_mutex_lock(pthread_mutex_t *mutex) {
    int rc = pthread_mutex_lock(mutex);
    assert(rc == 0);
}
```

<div class = "center-column">

（Figure 27.4: An Example Wrapper）

</div>

這種寫法能讓主程式碼更乾淨，前提是發生錯誤時程式可以直接 exit（例如開發階段）。 呼叫時若 `pthread_mutex_lock()` 失敗，`assert(rc == 0)` 會直接終止程式執行

在 pthreads 函式庫中，與 locks 有關的函式不只 lock 和 unlock。 還有兩個常見的函式如下：

```c
int pthread_mutex_trylock(pthread_mutex_t *mutex);
int pthread_mutex_timedlock(pthread_mutex_t *mutex,
                            struct timespec *abs_timeout);
```

這兩個函式都用來取得 lock。 如果 lock 已經被別人持有，`trylock` 會立即返回失敗； `timedlock` 則會在取得 lock 或超過指定的 timeout 時返回（兩者擇一）。 因此，如果你將 timeout 設為 0，`timedlock` 的行為就會退化成 `trylock`

一般來說應該盡量避免使用這兩種方式； 不過，在某些情況下，為了避免 thread 在等待 lock 時「卡死」（也許是無限期地卡住），使用這些方法會比較好。 我們會在後面幾章討論像 deadlock（死鎖）這樣的議題時看到這些例子

## 27.4 Condition Variables

threads library 的另一個重要組成（尤其在 POSIX threads 裡）就是 condition variable（條件變數）。 當 threads 間需要彼此發送訊號、例如一個 thread 必須等待另一個完成某個行為才能繼續時，condition variable 就很有用。 程式可以用以下兩個主要函式來進行這類互動：

```c
int pthread_cond_wait(pthread_cond_t *cond,
                      pthread_mutex_t *mutex);
int pthread_cond_signal(pthread_cond_t *cond);
```

使用 condition variable 時，還必須搭配一個 lock。 每次呼叫上面任一函式時，都應該先持有這個 lock

第一個函式 `pthread_cond_wait()` 會讓呼叫它的 thread 進入睡眠狀態，並等待其他 thread 傳來訊號，通常是當某些程式狀態變化、而該 thread 會關心這個變化時才被喚醒。 典型用法如下：

```c
pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
pthread_cond_t cond = PTHREAD_COND_INITIALIZER;

Pthread_mutex_lock(&lock);
while (ready == 0)
    Pthread_cond_wait(&cond, &lock);
Pthread_mutex_unlock(&lock);
```

這段程式會先初始化 lock 和 condition 變數，然後 thread 會檢查 `ready` 是否還是 0。 如果是，就呼叫 `pthread_cond_wait()` 進入睡眠，直到其他 thread 把它喚醒為止

在其他 thread 中執行、負責喚醒的程式碼會像這樣：

```c
Pthread_mutex_lock(&lock);
ready = 1;
Pthread_cond_signal(&cond);
Pthread_mutex_unlock(&lock);
```

這段程式有幾點要注意。 首先，在 signaling（以及修改全域變數 ready）時，我們一定會持有 lock，這是為了避免 race condition

第二，你可能注意到 wait 呼叫要傳入 lock，但 signal 只傳入 condition。 原因是：wait 除了讓呼叫者進入睡眠，還會在 thread 睡著時「釋放」lock。 試想如果它不釋放 lock，那其他 thread 怎麼取得 lock 來發送 signal 喚醒它？ 不過，一旦 thread 被喚醒、`pthread_cond_wait()` 結束前，會重新取得 lock，確保從 wait 開始到 wait 結束期間 thread 一直都持有 lock

最後還有一點很奇怪：為什麼要用 while 迴圈重新檢查條件，而不是用 if 判斷一次就好？ 我們會在後面的章節更詳細探討這個問題。 簡單來說，用 while 是比較保險的做法。 雖然會重複檢查條件（稍微增加一點負擔），但某些 pthread 實作可能會「誤喚醒」thread； 這時如果你沒重檢查，thread 會以為條件變了，其實卻沒有。 所以，把喚醒視為「可能有東西改變」的提示，而不是絕對的事實，會比較安全

有時候會有人想偷懶，用一個簡單的 flag 來讓 thread 互相發訊號，而不是用 condition variable 搭配 lock。 例如，可以把剛剛的等待程式改成這樣：

```c
while (ready == 0)
    ; // spin
```

而發訊號的程式碼就只是這樣：

```c
ready = 1;
```

千萬不要這麼做！ 原因有兩個。 第一，這種 spinning 的寫法效能很差（一直 spin 會浪費大量 CPU 時間）。 第二，它很容易出錯，根據近期研究 [X+10]，用這種 flag 同步的做法意外地容易寫錯； 該研究發現，約一半的類似程式都存在 bug！ 所以請不要偷懶，就算你覺得可以不用 condition variable，也還是乖乖用

如果你覺得 condition variable 聽起來很難，不用太擔心，後面的章節我們會非常詳細地講解它。 在那之前，你只要知道它的存在，並稍微了解它是什麼、為什麼要用就夠了

## 27.5 Compiling and Running

本章中所有的程式範例都相對容易上手。 要編譯這些程式碼，你必須在程式中 include `pthread.h` 標頭檔。 並且在編譯的連結階段，你還必須顯式地加入 `-pthread` 這個參數，來連結 pthreads 函式庫

例如要編譯一個簡單的 multi-threaded 程式，你只需要下這行指令：

```bash
prompt> gcc -o main main.c -Wall -pthread
```

只要 `main.c` 有 include pthreads 的標頭檔，你就成功編譯出一個 concurrent 程式了。 至於它會不會動、動得正不正確，那就是另一回事了

## 27.6 Summary

我們已經介紹了 pthread 函式庫的基本內容，包括 thread 的建立、使用 lock 來實現 mutual exclusion，以及透過 condition variable 進行 signal 與等待。 除了耐心與高度的小心之外，你不需要更多額外工具就能撰寫出穩定且高效的 multi-threaded 程式碼

本章的最後，我們會列出一些寫 multi-threaded 程式時實用的建議（詳見下一頁的補充段落）。 當然，pthread API 還有很多其他面向值得探索； 如果你想知道更多內容，可以在 Linux 系統上輸入 `man -k pthread`，你會看到超過一百個 API

不過，這章所介紹的基本概念與工具，已經足以讓你建立複雜（且希望是正確且高效能的）multi-threaded 程式。 寫 thread 程式最困難的地方不是 API，而是如何正確地設計出一個能運作的 concurrency 邏輯。 請繼續閱讀後續章節來深入了解

:::info  
使用 thread API 的建議指引

當你使用 POSIX thread 函式庫（或任何 thread 函式庫）來撰寫 multi-threaded 程式時，有一些雖然看起來微小但非常重要的事情要注意，包括：

- 保持簡單。 任何用來 lock 或 signal 的程式碼都應該儘可能簡潔。 thread 之間若有太多複雜互動，幾乎一定會導致 bug
- 減少 thread 互動。 讓 threads 互相影響的方式越少越好。 每一種互動都應該經過仔細思考與設計，並且盡量使用已知有效的作法（後續章節會介紹很多）
- 記得初始化 locks 與 condition variables。 忘記初始化會讓程式在某些情況下看起來能正常執行、但在其他情況下會發生奇怪的錯誤
- 檢查你的回傳值。 寫任何 C 或 UNIX 程式時都應該檢查每一個函式呼叫的回傳碼，這裡也一樣。 如果你沒做這件事，程式可能會出現超怪又難以理解的行為
- 小心地傳遞參數與回傳值給 thread。 特別是如果你傳遞的是 stack 上變數的指標，那你很可能做錯了什麼
- 每個 thread 都有自己的 stack。 延續上一點，每個 thread 有自己獨立的 stack，因此在 thread 裡面函式中宣告的區域變數，只屬於該 thread，其他 thread 無法（輕易地）存取。 若要在 threads 間共享資料，必須把資料放在 heap 或其他能全域存取的位置
- thread 間傳遞訊號時一定要用 condition variable。 雖然你可能會很想用簡單的 flag 解決，但請別這麼做
- 善用 man page。 特別是在 Linux 上，pthread 的 man page 非常詳細，對於這章提到的許多細節都有更深入的說明。 請仔細閱讀！  
:::

## References

- [B89] “An Introduction to Programming with Threads” by Andrew D. Birrell. DEC Technical Report, January 1989.  
  可線上取得：https://birrell.org/andrew/papers/035-Threads.pdf。 這是一篇經典但較早期的 threaded programming 入門文件。 雖然年代久遠，但仍非常值得一讀，而且免費公開

- [B97] “Programming with POSIX Threads” by David R. Butenhof. Addison-Wesley, May 1997.  
  另一本關於 threads 的好書，專注於 POSIX threads 的實作

- [B+96] “PThreads Programming: by A POSIX Standard for Better Multiprocessing. ” Dick Buttlar, Jacqueline Farrell, Bradford Nichols. O’Reilly, September 1996  
  這是 O’Reilly 出版的一本不錯的實用書籍。 O’Reilly 向來以實用為導向，我們的書架上也有不少該出版社的書，包括關於 Perl、Python、Javascript 的經典書（例如 Crockford 的 “Javascript: The Good Parts”）

- [K+96] “Programming With Threads” by Steve Kleiman, Devang Shah, Bart Smaalders. Prentice Hall, January 1996.  
  這可能是這個主題上最優秀的書籍之一。 你可以去圖書館找找

- [X+10] “Ad Hoc Synchronization Considered Harmful” by Weiwei Xiong, Soyeon Park, Jiaqi Zhang, Yuanyuan Zhou, Zhiqiang Ma. OSDI 2010, Vancouver, Canada.  
  這篇論文展示了即使是看似簡單的同步程式碼，也可能導致大量的 bug。 所以請你一定要使用 condition variable，並正確地進行 signaling！