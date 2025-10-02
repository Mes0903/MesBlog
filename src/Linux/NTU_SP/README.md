---
title: （WIP）台大 SP 筆記
date: 2025-10-01
tag: Linux
category: Linux
---

# 台大 SP 筆記

大部分是用 GPT 整理的就是了，簡單修一下而已。 只是自用筆記，想好好學的人去上課或是讀 TLPI 吧XD

## File IO

### buffered v.s. unbuffered I/O

buffered I/O 跟 unbuffered I/O 的差別主要在資料處理流程中是否經過額外的快取區 (buffer)

1. Buffered I/O (緩衝 I/O)
   - 流程：  
     程式要寫資料時，先寫入到記憶體中的 buffer (快取區)，等 buffer 滿了或被強制 flush 時，才一次性寫到裝置 (像硬碟或網路)。 讀取時則會先把一大塊資料讀進 buffer，程式從 buffer 取資料
   - 特點：  
     - 系統呼叫 (syscall) 次數少 → 效能較高
     - 適合大量小資料的存取，因為可以合併操作
     - 需要額外的記憶體來做 buffer
     - 可能有延遲：寫入後不一定馬上到達裝置，若程式 crash 或斷電，資料可能還沒 flush
   - 例子：
     - C 語言的 `fopen()/fread()/fwrite()` (標準 I/O library)，就是 buffered I/O
     - Linux shell 的 `cat file`，實際是經過 libc 的 buffer

2. Unbuffered I/O (非緩衝 I/O)
   - 流程：  
     每次 `read()` 或 `write()` 系統呼叫，程式資料直接和作業系統核心的 I/O 子系統交互，通常會直達裝置 driver
   - 特點：
     - 每次操作都要進行 syscall，效能可能較差
     - 但動作是立即的，不會延遲
     - 適合需要確定資料馬上寫出的場合 (例如 log、即時系統)
     - 沒有額外 buffer，因此行為比較「可預測」
   - 例子：
     - Unix/Linux 的 `read()` / `write()` 系統呼叫就是 unbuffered I/O
     - C 語言 `open()` 搭配 `read()/write()`

### File I/O & File Descriptors

#### 1. 當程式對檔案做操作時會發生什麼？

當一個 process (行程) 執行 `open`, `read`, `write` 等檔案操作時，背後涉及：

- 磁碟上的資料 (on-disk data)
  - 檔案的實際內容 (file contents)
  - 檔案的 metadata (中繼資料)，例如：
    - 檔案權限 (permissions)
    - 檔案實際在磁碟上的位置 (disk blocks)
    - 其他資訊 (e.g., 時間戳、owner、link count 等，課堂後續會再深入)

也就是說，檔案不只包含了「內容」，還包含「描述內容的資料」

#### 2. 在 Unix 中的檔案存取規則

- 必須先 `open()`：  
  在 Unix 系統中，行程必須先打開檔案，才能進行讀寫
- 同一 process 可多次開啟同一檔案  
  例如：`open("foo.txt")` 兩次，會得到兩個獨立的 file descriptor
- 多個 process 可以同時開啟同一檔案  
  因此 OS 核心 (kernel) 需要追蹤每個 process 與檔案的關聯

重點：kernel 必須維護一份資料結構，記錄「哪個行程、透過哪個 file descriptor，正使用哪個檔案」

#### 3. File Descriptor (檔案描述符)

- 定義：  
  在 Unix 中，kernel 以 file descriptor (FD) 來表示一個「已開啟的檔案」
- 特性：
  - file descriptor 是一個非負整數
  - 範圍：`0 ~ OPEN_MAX-1`
    - `OPEN_MAX` 表示一個 process 最多能同時開啟多少檔案
  - per-process：  
    每個行程都有自己獨立的 FD table，因此兩個 process 可能擁有相同數字的 FD，但指向不同的檔案
- 例子：
  Process A 的 fd=3 可能是 `a.txt`，Process B 的 fd=3 可能是 `b.txt`，因為它們的 FD table 各自獨立

#### 4. 標準檔案描述子 (Standard File Descriptors)

對於每個 process 的 file descriptor table 而言，Unix 約定俗成地將 0, 1, 2 綁定到了三個特殊的檔案：

- `0` → 標準輸入 (stdin)
- `1` → 標準輸出 (stdout)
- `2` → 標準錯誤 (stderr)

這些數字對應到 POSIX.1 標準定義的常數：

- `STDIN_FILENO` (0)
- `STDOUT_FILENO` (1)
- `STDERR_FILENO` (2)

這些常數定義在 `<unistd.h>` 標頭檔中

底下這個例子會「把標準輸入複製到標準輸出」，就像精簡版的 `cat` 命令（但用的是 unbuffered I/O 的 `read`/`write`，不是 `fread`/`fwrite`）：

```c
#include <unistd.h>

int main(void)
{
	char buf[100];
	ssize_t n;

	while ((n = read(STDIN_FILENO, buf, 100)) != 0)
		write(STDOUT_FILENO, buf, n);

	return 0;
}
```

- `read(STDIN_FILENO, buf, 100)`：從 fd=0（stdin） 讀最多 100 bytes 到 `buf`，回傳讀到的實際位元組數 `n`
  - `n > 0`：讀到資料
  - `n == 0`：EOF（輸入結束）
  - `n == -1`：錯誤（需看 `errno`）
- `write(STDOUT_FILENO, buf, n)`：把剛讀到的 `n` bytes 寫到 fd=1（stdout）
- 迴圈：重複讀→寫，直到 `read()` 回傳 0（EOF）

### File I/O：`open`、`openat` & `close`

```c
#include <fcntl.h>
int open(const char *path, int oflag, ... /* mode_t mode */);
int openat(int fd, const char *path, int oflag, ... /* mode_t mode */);
```

- 一個 process 可以透過 `open` 或 `openat` 來開啟或建立檔案
- 成功時會回傳「file descriptor」，失敗時回傳 -1
- 回傳的 file descriptor 會是當前 process 尚未使用的最小編號

#### `open()`

##### `open()` 的參數

- `path`：欲開啟或建立檔案的路徑，可以是「絕對路徑」或「相對路徑」
- `oflag`：指定檔案的存取模式與其他旗標

##### `oflag` 存取模式（三選一）

- `O_RDONLY`：只讀
- `O_WRONLY`：只寫
- `O_RDWR`：讀寫

##### `oflag` 的額外旗標（可用 OR 組合）

- `O_APPEND`：每次寫入時自動附加在檔尾
- `O_TRUNC`：開啟檔案時將大小截斷為 0
- `O_CREAT`：若檔案不存在就建立它
- `O_NONBLOCK`：非阻塞模式
- `O_SYNC` / `O_DSYNC` / `O_RSYNC`：同步 I/O，確保資料或 metadata 寫入完成

##### `open()` 與 mode

```c
#include <fcntl.h>
int open(const char *path, flag | O_CREAT, mode_t mode);
```

- 當指定「`O_CREAT`」時，必須額外提供「`mode`」參數
- `mode` 指定新建檔案的權限
- `mode` 會與「`umask`」結合：任何在 `umask` 中設定的 bit，會被清除
- 例子：
  - `umask=0x22`
  - 新建檔案時 `mode=0x777`
  - 最終檔案權限為 `0x755`
- `mode` 常數（檔案權限）
  - `S_IRWXU`：`00700`，使用者有讀、寫、執行權限
  - `S_IRUSR`：`00400`，使用者有讀權限
  - `S_IWUSR`：`00200`，使用者有寫權限
  - `S_IXUSR`：`00100`，使用者有執行權限
  - `S_IRWXG`：`00070`，群組有讀、寫、執行權限
  - `S_IRGRP`：`00040`，群組有讀權限
  - `S_IWGRP`：`00020`，群組有寫權限
  - `S_IXGRP`：`00010`，群組有執行權限
  - `S_IRWXO`：`00007`，其他人有讀、寫、執行權限
  - `S_IROTH`：`00004`，其他人有讀權限
  - `S_IWOTH`：`00002`，其他人有寫權限
  - `S_IXOTH`：`00001`，其他人有執行權限

好的，我幫你整理成一份筆記，符合你指定的格式（中文與英文之間加一個空白，括號用中文大寫括號）

#### `openat()`

- `openat()` 和 `open()` 的行為幾乎相同，不同之處在於參數 `fd` 與 `path` 的組合
- 如果 `path` 是「絕對路徑」，參數 `fd` 會被忽略
- 如果 `path` 是「相對路徑」：
  - 若 `fd` 為 `AT_FDCWD`，則 `path` 會以「目前工作目錄」為基準解譯
  - 若 `fd` 指向一個已開啟的目錄，則 `path` 會以該目錄為基準解譯
- 例子：
  ```c
  int dirfd = open("..", O_RDONLY);
  int fd = openat(dirfd, "test", O_RDWR | O_CREAT);
  ```

  等價於

  ```c
  int fd = openat(AT_FDCWD, "../test", O_RDWR | O_CREAT);
  ```
- `openat()` 支援相對於某個已開啟目錄的檔案開啟
- `open()` 只能支援相對於「目前工作目錄」的檔案開啟
- `open()` 因為固定依賴當前工作目錄，容易受到「TOCTTOU 攻擊」(Time Of Check To Time Of Use)。 這是一種競態條件攻擊，後面會在介紹 symbolic links 後再深入探討

#### `close()`

```c
#include <fcntl.h>
// 成功回傳 0，錯誤回傳 -1
int close(int fd);
```

- 呼叫 `close` 即可關閉一個已開啟的檔案
- 當一個 process 終止時，kernel 會自動關閉它所有已開啟的檔案
- 許多程式因此不會顯式地呼叫 `close`，而是依賴 process 終止時自動關閉

### File I/O: `creat`

```c
#include <fcntl.h>
// 成功時回傳一個 file descriptor，失敗時回傳 -1
int creat(const char *path, mode_t mode);
```

- 呼叫 `creat` 會建立一個檔案，並且以 write-only 模式開啟
- 這個函式功能與 `open` 重疊
- `open(path, O_WRONLY | O_CREAT | O_TRUNC, mode)` 等價於 `creat(path, mode)`
- 因為功能重複，`creat` 現在幾乎已經過時
- 問題：如果要「建立並以 read-write 模式開啟檔案」怎麼辦？
  - `creat` 不支援讀寫開啟，正解是：`open(path, O_RDWR | O_CREAT | O_TRUNC, mode)`
- `O_TRUNC` 標誌的行為
  - 如果檔案已存在，且是「一般檔案」，而且存取模式允許寫入 (`O_RDWR` 或 `O_WRONLY`)，則檔案大小會被截斷為 0
  - 如果檔案是 FIFO 或終端機裝置檔，`O_TRUNC` 會被忽略
  - 其他情況下，`O_TRUNC` 的行為未定義

### Unix Kernel 對 File I/O 的支援

Unix 核心在管理一個開啟的檔案時，使用三種資料結構。 它們之間的關係會影響多個 process 共享檔案時的行為：

- Open file descriptor table（每個 process 各自擁有）
- Open file table（整個系統共享）
- V-node table（整個系統共享）

#### Open file descriptor tabl

- 每個 process 有一張自己的表
- 每個 entry 對應一個 file descriptor
- entry 內容：
  - file descriptor flag（例如 close-on-exec 等，之後會介紹）
  - 指向「open file table」中某一項的指標

#### Open file table

- 每個開啟的檔案在系統中會有一個 entry
- 每個 entry 的內容包含：
  - file status flag（例如 readable/writable/append/sync/nonblocking）
  - 檔案目前的 offset（檔案指標位置）
  - 指向「v-node table」中某一項的指標

#### V-node（i-node）table

- 每個 entry 代表一個 v-node（虛擬節點結構）
- v-node 內容包含：
  - 指向對應 i-node 的指標
  - v-node 資訊（檔案類型，以及操作檔案所需的函式指標）

#### V-node 與 I-node 的區別

- V-node
  - 是一種「記憶體中的結構」，用來抽象化不同檔案系統
  - 儲存檔案類型，以及操作檔案的函式指標
  - 發明目的是讓單一電腦能同時支援多種檔案系統
- I-node
  - 同時存在於磁碟與記憶體中
  - 包含檔案的 metadata：
    - 檔案擁有者
    - 檔案大小
    - 檔案所屬裝置
    - 權限資訊
    - 資料區塊在磁碟上的位置
  - 當檔案被打開時，作業系統會把對應的 i-node 從磁碟載入到記憶體，方便之後的操作
- 早期 Unix 使用 v-node 概念，讓不同檔案系統有統一的接口
- Linux 本身並沒有獨立的 v-node，取而代之使用 generic i-node，概念上等同於 v-node

#### Big picture

![（From APUE 3rd Edition: Figure 3.7）](image/APUE3.7.png)

上圖中可見：

- 每個 process 有自己的「open file descriptor table」，表格裡每一列對應一個 fd（例如 0、1、2…），包含「fd flags」與一個指向「open file table entry」的指標
- 「open file table」（全系統共享）的一個 entry 代表一次「open」動作的結果，保存：
  - file status flags（可讀／可寫／append／sync／nonblocking…）
  - current file offset（檔案位移點）
  - 指向「v-node table entry」的指標
- 「v-node table entry」封裝檔案系統無關的抽象，內含 v-node information 與 v_data，並連到對應的 i-node
- 「i-node」保存檔案的 metadata（owner、size、權限、資料區塊位置…）與目前檔案大小，以及回指到 vnode（實作上視系統而定）
- 讀圖要點：
  - process 的 fd 並不直接指向 i-node，而是經由「open file table」再到「v-node／i-node」
  - 同一個 process 可以同時擁有多個 fd，各自指向不同的「open file table entry」，而這些 entry 最終可能指向相同的檔案（相同 v-node／i-node）

![（From APUE 3rd Edition: Figure 3.8）](image/APUE3.8.png)

上圖中可見：

- 兩個互不相關的 processes 分別對同一個檔案呼叫一次 `open` 時，情況如下：
  - 每個 process 的 fd 指向「自己的」open file table entry（彼此不同）
  - 兩個 open file table entries 最終都指向「同一個」v-node／i-node（因為是同一個檔案）
- 重要影響：
  - 因為 open file table entry 不同，「current file offset」是各自獨立的。 A 讀了 100 bytes 不會改變 B 的 offset
  - 「file status flags」也各自獨立。 A 可以用 `O_RDONLY` 開啟，B 可以用 `O_RDWR`
  - 底層檔案內容與大小由同一個 i-node 代表，所以任一方寫入會改變同一份檔案的內容與可能的大小（另一方之後讀到的資料會反映更新）

一些小整理：
  - 若是同一個 process 對同一個 fd 做 `dup`（或 `fork` 之後尚未 `exec`，父子繼承相同 open），會讓多個 fd 指向「同一個」open file table entry，這種情況下「file offset」是共享的。 圖二展示的是「兩次獨立的 open」，所以 offset 不共享
  - fd（per-process）→ open file table（per-open）→ v-node／i-node（per-file）
  - 是否「共享 offset／status flags」取決於兩個 fd 是否指向同一個「open file table entry」：
    - 同一個 entry（例如 `dup`、`fork` 後未重新 `open`）：共享 offset／status
    - 不同 entry（兩次獨立 `open`）：offset／status 各自獨立，但指向同一 v-node／i-node，因此共享檔案內容
