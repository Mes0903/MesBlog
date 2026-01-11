---
title: （WIP）VirtIO-GPU in semu
date: 2026-01-09
mathjax: true
tag: 
- VM
- virtio
category:
- VM
- virtio
---

# VirtIO-GPU in semu

專題，預期產出是

- 最低限度在 semu 支援 virtio 2D (with SDL)
- 支援 virtio-gpu 及 virtio-input
- 實作 host-GL accelerated path，讓 virtio-gpu 得以 passthrough

目前已將 2D 的部分閱讀與整理完畢，剛將 commit 整理完畢，重新編譯沒問題後就 rebase 並發送 PR

材料部份，目前已初步閱讀完 spec 中 virtqueue（ch1 & 2）、PCI（4.1）與 GPU（5.7）的部分。 另外也閱讀了一些還閱讀了一些 graphic stack 的東西，因此寫了一些筆記

- [Red Hat Virtio 介紹文的翻譯 & 筆記](https://mes0903.github.io/VM/redhat_virtio/)
- [Virtual I/O Device (VIRTIO) Version 1.3 翻譯 & 筆記](https://mes0903.github.io/VM/virtio_spec/)
- [The Linux graphics stack in a nutshell 翻譯 & 筆記](https://mes0903.github.io/Linux/linux-graphic-stack/)

還有一些尚在進行中的筆記，集中在 DRM/KMS 的部分，底下是針對目前 semu 中 vgpu 2D 部分的實作的筆記，3D 部分尚未開始

## 有關 VirGL

以下片段翻譯自 [Do Nvidia GPUs require Mesa? (re: what is Mesa vs proprietary drivers?)](https://www.reddit.com/r/linux_gaming/comments/9firc7/do_nvidia_gpus_require_mesa_re_what_is_mesa_vs/)：

在 Linux 當中，所有硬體的驅動程式都會以某種形式被包含在核心裡面，這當然也包含了 GPU 驅動。 每一張 GPU 都需要一個核心驅動（或說 kernel module 模組）才能運作

但核心驅動只負責最低層級的硬體操作。 像 OpenGL、Vulkan、OpenCL 這些 API 的實作太龐大，無法放進核心驅動中，因此被放在 user space，透過系統呼叫與核心互動

要使用任何圖形 API，你都需要有對應的使用者空間函式庫。 AMD 與 NVIDIA 的專有驅動都有提供每一個 API 的封閉原始碼版本，而 Mesa 則是試圖提供這些 API 的開源替代實作

專有驅動通常也會附帶它們自己專有的核心驅動／模組，用來和它們的使用者空間函式庫溝通。 但對於 AMD 的新 GPU 來說，情況稍有不同：他們的專有與開源驅動會共用同一個核心模組。 換句話說，若你使用的是 Radeon R9 285（GCN 3） 之後的 GPU，你可以在相同的 AMDGPU 核心驅動 下，選擇搭配 Mesa（開源函式庫）或 AMD 專有函式庫

---

再來以 Collabora 的這張圖來說，VirGL 是適用於 virtio-gpu 的 OpenGL 驅動，Venus 是 virtio-gpu 的 Vulkan 驅動，這兩者都實作在 Mesa 中：

![image](https://hackmd.io/_uploads/Skn-n5cpxl.png)
![image](https://hackmd.io/_uploads/SJm935caex.png)

但因為 virtio-gpu 只定義了要有哪些行為，例如建立 context、建立 BLOB 資源或提交 3D 指令之類的，所以實際填入 virtqueue 的內容（payload）是由實作方決定的

具體來說要填入的內容是能讓 host 端轉譯器看懂的 payload，因此格式是以實作自己的協定來定義的，現在主流的實作是 Virgl 與 Venus（近年有新的叫 vDRM），他們在 host 端配合的轉譯器是 virglrenderer，用來解碼 VirGL/Venus 與 vDRM 的命令，再把這些命令轉成 host 端的 OpenGL/Vulkan 呼叫

所以 virtio-gpu 決定封包的格式，而實作本身決定封包內容要怎麼解讀

實作用的協定本身不一定有 spec（神奇），VirGL 就沒有，所以要直接看實作（[VirGL](https://gitlab.freedesktop.org/mesa/mesa/-/blob/main/src/gallium/drivers/virgl/virgl_encode.c?ref_type=heads)、[virglrenderer](https://gitlab.freedesktop.org/virgl/virglrenderer/-/blob/main/src/virgl_protocol.h)），但 Venus 有（[venus-protocol](https://gitlab.freedesktop.org/virgl/venus-protocol)）

## Big Picture

### Resource 資料結構

#### `vgpu_resource_2d` 與 `display_info`

每個 2D resource 使用 `struct vgpu_resource_2d` 表示（定義於 virtio-gpu.h:19）：

```c
struct vgpu_resource_2d {
    uint32_t scanout_id;      // 綁定的 scanout ID
    uint32_t resource_id;     // 資源 ID
    uint32_t format;          // 像素格式（如 ARGB8888）
    uint32_t width;           // 寬度
    uint32_t height;          // 高度
    uint32_t stride;          // 每行的位元組數
    uint32_t bits_per_pixel;  // 每像素位元數
    uint32_t *image;          // Host 端的圖像 buffer
    size_t page_cnt;          // Guest 提供的記憶體頁數
    struct iovec *iovec;      // Guest 記憶體頁的位址與長度
    struct list_head list;    // 連結串列節點
};
```

所有的 2D resource 以連結串列方式管理，串列頭為 `vgpu_res_2d_list`（virtio-gpu.c:54）

而 `display_info` 是 SDL 視窗後端層的狀態結構（定義在 window-sw.c:18-40）：

```c
struct display_info {
    int render_type;
    struct vgpu_resource_2d resource;     // 主平面資源
    uint32_t primary_sdl_format;
    SDL_Texture *primary_texture;
    struct vgpu_resource_2d cursor;       // 鼠標平面資源
    uint32_t cursor_sdl_format;
    uint32_t *cursor_img;
    SDL_Rect cursor_rect;
    SDL_Texture *cursor_texture;
    SDL_mutex *img_mtx;
    SDL_cond *img_cond;
    SDL_Thread *win_thread;
    SDL_Thread *ev_thread;
    SDL_Window *window;
    SDL_Renderer *renderer;
};
```

兩者屬於不同層次的資料結構：`vgpu_resource_2d` 是「virtio-gpu 裝置模型（device model）層」的資源物件； `display_info` 是「SDL 視窗後端（render backend）層」的每個 scanout 視窗狀態，內含兩個 plane（primary/cursor）要用來算繪的資源快照與 SDL 物件

`vgpu_resource_2d` 在 semu 內代表一個 virtio-gpu 的 2D resource（以 `resource_id` 為 key 來管理），它同時承載：

- 協定層會出現的概念
  - `resource_id`：guest 用來參考（refer）的 handle
  - `format/width/height`
  - `scanout_id`：目前被 `SET_SCANOUT` 綁定到哪個 scanout（semu 的做法是直接存到 resource 上）
- semu 內部實作需要的狀態（host-private）
  - `iovec/page_cnt`：`RESOURCE_ATTACH_BACKING` 後，記住 guest backing pages 對應到 host pointer 的 scatter-gather 描述
  - `image/stride/bits_per_pixel`：semu SW path 額外維護的一份「連續」影像緩衝區（staging/render buffer），方便 SDL 以單一 surface/texture 取用
  - `list`：放進資源串列以做查找與生命週期管理

`display_info` 則是 SDL 視窗後端的「每個 scanout 的算繪狀態」（render-side state），會為每個 scanout 維護一個 SDL window/thread，並提供兩個 plane 的算繪資源：

- Primary plane
  - `struct vgpu_resource_2d resource;`
  - `primary_sdl_format`, `primary_texture`
- Cursor plane
  - `struct vgpu_resource_2d cursor;`
  - `cursor_img`（cursor 專用的像素複本）
  - `cursor_rect`, `cursor_texture`
- 同步與執行緒/SDL 物件
  - `img_mtx`/`img_cond`：通知 window thread 有更新要重畫
  - `win_thread/ev_thread/window/renderer`

`display_info` 會引用或複製 `vgpu_resource_2d` 的內容來做算繪，以 2D 的 software backend（`window_thread` 函式）來說：

1. Primary plane：shallow copy metadata，直接引用同一塊 image

   `window_flush_sw(scanout_id, res_id)` 會做：
   - `resource = vgpu_get_resource_2d(res_id)` 取回 resource list 裡的 canonical resource
   - `memcpy(&display->resource, resource, sizeof(struct vgpu_resource_2d))`
  
   這個 memcpy 會把指標欄位也複製進去，所以 `display->resource.image` 會指向同一塊 `resource->image`（也就是 `TRANSFER_TO_HOST_2D` 寫入的那塊連續 buffer）

   接著 window thread 會用 `SDL_CreateRGBSurfaceWithFormatFrom(resource->image, ..., pitch=stride, ...)` 把這塊記憶體包成 surface，再建 texture
2. Cursor plane：deep copy 像素到 `cursor_img`，避免後續資源改動影響游標

    `cursor_update_sw()` 的做法不同：

    - 先 `memcpy(&display->cursor, resource, sizeof(...))` 複製 metadata
    - 但隨後分配 `display->cursor_img`，並 `memcpy(display->cursor_img, resource->image, pixels_size)`
    - 再把 `display->cursor.image = display->cursor_img`

    因此 cursor plane 的像素在 `display_info` 內有自己的一份副本，後續即使原本的 resource 更新，也不會影響目前 cursor 的 texture

詳細見後方章節與原始碼

#### Virtqueue 相關

semu 中使用的是 split virtqueue，其中只有 descriptor table 有特別寫結構體定義出來：

```c
PACKED(struct virtq_desc {
    uint64_t addr;
    uint32_t len;
    uint16_t flags;
    uint16_t next;
});
```

而在規格中，對於 avail ring 與 used ring 的佈局示例如下：

```c
struct virtq_avail { 
#define VIRTQ_AVAIL_F_NO_INTERRUPT  1 
    le16 flags; 
    le16 idx; /* driver 已經把多少個「可用的 ring entry」放進了 avail ring */
    le16 ring[ /* Queue Size */ ]; 
    le16 used_event; /* 只有在 VIRTIO_F_EVENT_IDX 協商成功時才存在 */ 
};

struct virtq_used { 
#define VIRTQ_USED_F_NO_NOTIFY  1 
    le16 flags; 
    le16 idx; /* device 已經完成並回報了多少個 used entries */
    struct virtq_used_elem ring[ /* Queue Size */]; 
    le16 avail_event; /* 只有在 VIRTIO_F_EVENT_IDX 協商成功時才存在 */ 
}; 

/* 這裡 id 使用 le32 是為了填補（padding）的考量。 */ 
struct virtq_used_elem { 
    /* 已用描述符鏈的頭節點索引 */ 
    le32 id; 
    /* 裝置對該描述符鏈中屬於「裝置可寫」部分實際寫入的位元組數 */ 
    le32 len; 
};
```

但在 semu 中，avail ring 與 used ring 都是透過直接操作記憶體（`vinput->ram`）來讀取的，相關結構如下（以 virtio gpu 為例）：

```c
typedef struct {
    uint32_t QueueNum;      // Queue 的大小
    uint32_t QueueDesc;     // Descriptor Table 的起始索引
    uint32_t QueueAvail;    // Available Ring 的起始索引
    uint32_t QueueUsed;     // Used Ring 的起始索引
    uint16_t last_avail;    // Device 已處理了幾個 buffer
    bool ready;             // Queue 是否就緒
} virtio_gpu_queue_t;

typedef struct {
    /* feature negotiation */
    uint32_t DeviceFeaturesSel;
    uint32_t DriverFeatures;
    uint32_t DriverFeaturesSel;
    /* queue config */
    uint32_t QueueSel;
    virtio_gpu_queue_t queues[2];
    /* status */
    uint32_t Status;
    uint32_t InterruptStatus;
    /* supplied by environment */
    uint32_t *ram;
    /* implementation-specific */
    void *priv;
} virtio_gpu_state_t;
```

`virtio_gpu_state_t` 中的 `queues` 是一個 virtqueue 的陣列，有兩個元素，代表 virtio-gpu 使用了兩個 virtqueue，在 spec 中分別名為 controlq 與 cursorq：

- controlq：用於傳送控制命令的佇列
- cursorq：用於傳送游標更新的佇列

`virtio_gpu_queue_t` 內的元素用來幫助讀取 virtqueue 的內容，`QueueDesc`、`QueueAvail`、`QueueUsed` 的值代表的是索引，會搭配 `virtio_xxx_state_t` 結構體內的 `ram` 成員使用，其中 `ram` 與 `emu->ram` 指向相同的記憶體區塊（main 裡面 malloc 的那塊 guest memory）

由於 avail ring 與 used ring 中的 `flags` 與 `idx` 欄位都是 `le16`，而 `ram` 是 `uint32_t*`，因此以 avail ring 為例，其在 `ram` 中的佈局看起來會類似下面這樣：

```
┌─────────────────────────────────┬──────────────────────────┐
│     ram[queue->QueueAvail]      │ flags (low) | idx (high) │  ← Header
├─────────────────────────────────┼──────────────────────────┤
│   ram[queue->QueueAvail + 1]    │    ring[0]  |  ring[1]   │  ← Entries 0 & 1
│   ram[queue->QueueAvail + 2]    │    ring[2]  |  ring[3]   │  ← Entries 2 & 3
│   ram[queue->QueueAvail + 3]    │    ring[4]  |  ring[5]   │  ← Entries 4 & 5
└─────────────────────────────────┴──────────────────────────┘
```

其中 `QueueAvail` 等值在對應的 `virtio_xxx_reg_write` 中設定：

```c
static inline uint32_t vinput_preprocess(virtio_input_state_t *vinput,
                                         uint32_t addr)
{
    // 1. 檢查地址是否在 RAM 範圍內
    if (addr >= RAM_SIZE)
        return virtio_input_set_fail(vinput), 0;
    
    // 2. 檢查地址是否 4-byte 對齊
    if (addr & 0b11)  // 檢查最低 2 bits
        return virtio_input_set_fail(vinput), 0;

    // 3. 將「字節地址」轉換為「uint32_t 索引」
    return addr >> 2;  // 除以 4
}

...

static bool virtio_input_reg_write(virtio_input_state_t *vinput,
                                   uint32_t addr,
                                   uint32_t value)
{
...
case _(QueueDriverLow):
    VINPUT_QUEUE.QueueAvail = vinput_preprocess(vinput, value);
    return true;
...
}
```

因此如果 Guest 寫入的地址為 `0x80100000`，則 `QueueAvail` 為 `0x20040000`。 也因為 `vinput->ram` 的型態為 `uint32_t*`，所以在訪問的時候該段記憶體的時候是用 `ram[0x80100000 >> 2]` 而非 `ram[0x80100000]`，所以才說 `QueueAvail` 是索引：

```
字節視圖 (uint8_t*):       Word 視圖 (uint32_t*):
┌────┬────┬────┬────┐     ┌──────────────┐
│ 0  │ 1  │ 2  │ 3  │  →  │   ram[0]     │
├────┼────┼────┼────┤     ├──────────────┤
│ 4  │ 5  │ 6  │ 7  │  →  │   ram[1]     │
├────┼────┼────┼────┤     ├──────────────┤
│ 8  │ 9  │ 10 │ 11 │  →  │   ram[2]     │
└────┴────┴────┴────┘     └──────────────┘

字節地址 / 4 = uint32_t 索引
```

以 `virtio_input_desc_handler` 為例子來看一些使用範例

1. 讀取 avail 與 used ring 的 `idx` 欄位
    ```c
    uint32_t *ram = vinput->ram;
    uint16_t new_avail = ram[queue->QueueAvail] >> 16; /* virtq_avail.idx (le16) */
    uint16_t new_used = ram[queue->QueueUsed] >> 16; /* virtq_used.idx (le16) */
    ```
2. 讀取 avail ring 內的第 `buffer_idx` 個元素
    ```c
    uint16_t queue_idx = queue->last_avail % queue->QueueNum;
    uint16_t buffer_idx = ram[queue->QueueAvail + 1 + queue_idx / 2] >>
                          (16 * (queue_idx % 2));
    ```
    這邊 `last_avail` 代表已處理過的 buffer 數量，由於 avail ring 是環形的，所以取模以得到下一個目標 buffer 的索引
    
    接下來的 `queue->QueueAvail + 1` 代表 avail ring 內 `ring` 的起始位址（`+1` 是為了跳過 header）； `queue_idx / 2` 用來找到目標 buffer 在 `ram` 的哪個元素內（見上方 avail ring 在 `ram` 中的示意圖）； 最後用 `16 * (queue_idx % 2)` 來找到對應的元素（一個 `ram` 的元素中有兩個 `ring` 的元素）

    因此整個 `buffer_idx` 的計算其實是在讀取 `ring[queue_idx]` 的值，而該值代表的是目標 descriptor 的索引，所以變數名稱才會是 `buffer_idx`
3. 讀取 Descriptor
    ```c
    uint32_t *desc;
    desc = &vinput->ram[queue->QueueDesc + buffer_idx * 4];
    vq_desc.addr = desc[0];  // buffer 的物理地址
    uint32_t addr_high = desc[1]; // 目前只支援 32-bit addressing，因此應為 0
    vq_desc.len = desc[2];   // buffer 大小
    vq_desc.flags = desc[3] & 0xFFFF;  // flags
    ```
    `*4` 是因為每個 descriptor 佔 4 個 `uint32_t`，而算 `flags` 時取 `& 0xFFFF` 是因為 flags 在 `desc[3]` 的低 16 位
4. 寫入事件到 Guest Buffer
    ```c
    ev = (struct virtio_input_event *)((uintptr_t)vinput->ram + vq_desc.addr);
    ev->type = input_ev[i].type;
    ev->code = input_ev[i].code;
    ev->value = input_ev[i].value;
    ```
    注意這邊 `vinput->ram` 是 host virtual address，其值的意義是 guest memory 在 semu 中的起始位址（`malloc` 出來的一塊記憶體），而 `vq_desc.addr` 是 guest physical address，因此相加就可以得到目標 `virtio_input_event`（descriptor 指向的 buffer）的 host virtual address，後續便可以直接操作該 buffer
5. 更新 used ring
    ```c
    uint32_t vq_used_addr = queue->QueueUsed + 1 + (new_used % queue->QueueNum) * 2;
    ram[vq_used_addr] = buffer_idx;
    ram[vq_used_addr + 1] = sizeof(struct virtio_input_event);
    ```
    與上方一樣，`new_used % queue->QueueNum` 是在計算目標 used ring entry 的索引，`*2` 是因為每個 used ring entry 佔 2 個 `uint32_t`（`id` + `len`）； 接著就依序填入目標 used ring entry 的 `id` 與 `len` 欄位

總體來說，virtqueue 操作的流程大致如下：

1. Linux 分配 virtqueue 記憶體  
   - `vring_create_virtqueue()`
   - 在 guest RAM 中分配 descriptor table, avail ring, used ring

2. Linux 寫入 MMIO registers (通過 `writel`)，見 `vm_setup_vq`：
   - `writel(addr_low, base + 0x080)`：`QUEUE_DESC_LOW`
   - `writel(addr_high, base + 0x084)`：`QUEUE_DESC_HIGH`
   - `writel(addr_low, base + 0x090)`：`QUEUE_AVAIL_LOW  `
   - `writel(addr_high, base + 0x094)`：`QUEUE_AVAIL_HIGH`
   - `writel(addr_low, base + 0x0a0)`：`QUEUE_USED_LOW`
   - `writel(addr_high, base + 0x0a4)`：`QUEUE_USED_HIGH`
   - `writel(1, base + 0x044)`：`QUEUE_READY`

3. SEMU 接收 MMIO write (`virtio_xxx_reg_write`)
   - `case QueueDescLow`：儲存 descriptor table 位址
   - `case QueueDriverLow`：儲存 available ring 位址
   - `case QueueDeviceLow`：儲存 used ring 位址
   - `case QueueReady`：標記 queue 就緒

4. 之後 SEMU 就可以通過這些位址訪問 guest 的 virtqueue 了
   - `ram[queue->QueueDesc + offset]`
   - `ram[queue->QueueAvail + offset]`
   - `ram[queue->QueueUsed + offset]`

### 算繪流程

以下是一個 semu 裡面的 GPU 算繪流程：

1. **初始化階段**（在 main.c 中執行）
   - 呼叫 `virtio_gpu_init` 初始化 VirtIO-GPU 裝置
   - 呼叫 `virtio_gpu_add_scanout` 新增 scanout
   - 呼叫 `g_window.window_init` 初始化 SDL 並建立視窗執行緒
     - event handling thread（`window_events_thread`）不是在 `window_init_sw` 內直接建立的，而是 在 `window_thread` 建好 SDL window/renderer 後才建立的（也就是 per-scanout 的 window thread 內會再開一條 event thread）

2. **Guest OS 啟動後查詢顯示資訊**
   - Guest 透過 MMIO 讀取 VirtIO-GPU 暫存器，發現裝置
   - Guest 發送 `VIRTIO_GPU_CMD_GET_DISPLAY_INFO` 指令
   - `virtio_gpu_get_display_info_handler` 回傳 scanout 的寬高資訊

3. **建立 framebuffer**
   - Guest 發送 `VIRTIO_GPU_CMD_RESOURCE_CREATE_2D` 建立 2D resource
   - `virtio_gpu_resource_create_2d_handler` 分配 `res_2d->image` buffer
   - Guest 發送 `VIRTIO_GPU_CMD_RESOURCE_ATTACH_BACKING` 附加 Guest 記憶體
   - `virtio_gpu_cmd_resource_attach_backing_handler` 記錄 Guest 記憶體頁到 `res_2d->iovec`

4. **綁定 scanout**
   - Guest 發送 `VIRTIO_GPU_CMD_SET_SCANOUT` 將 resource 綁定到 scanout
   - `virtio_gpu_cmd_set_scanout_handler` 設定 `res_2d->scanout_id`

5. **更新畫面**
   - Guest 將圖像資料寫入自己的 framebuffer（backing memory）
   - Guest 發送 `VIRTIO_GPU_CMD_TRANSFER_TO_HOST_2D` 傳輸像素資料
   - `virtio_gpu_cmd_transfer_to_host_2d_handler` 呼叫 `iov_to_buf` 從 Guest 記憶體複製資料到 `res_2d->image`
   - Guest 發送 `VIRTIO_GPU_CMD_RESOURCE_FLUSH` 請求顯示更新
   - `virtio_gpu_cmd_resource_flush_handler` 呼叫 `window_flush_sw`
   - `window_flush_sw` 喚醒視窗執行緒
   - `window_thread` 從 `res_2d->image` 建立 SDL texture 並算繪到視窗

### 函式呼叫關係總結

以下整理各函式的呼叫關係：

- **初始化流程**
  - `main` → `virtio_gpu_init`
  - `main` → `virtio_gpu_add_scanout` → `window_add_sw`
  - `main` → `g_window.window_init` → `window_init_sw` → `window_thread`

- **暫存器存取**
  - MMIO load → `virtio_gpu_read` → `virtio_gpu_reg_read`
  - MMIO store → `virtio_gpu_write` → `virtio_gpu_reg_write`
  - `virtio_gpu_reg_write` (QueueNotify) → `virtio_queue_notify_handler`

- **指令處理**
  - `virtio_queue_notify_handler` → `virtio_gpu_desc_handler`
  - `virtio_gpu_desc_handler` → `g_vgpu_backend.*` (各指令處理函式)

- **2D 資源管理**
  - `virtio_gpu_resource_create_2d_handler` → `vgpu_create_resource_2d`
  - 各指令處理函式 → `vgpu_get_resource_2d`
  - `virtio_gpu_cmd_resource_unref_handler` → `vgpu_destory_resource_2d`

- **畫面算繪**
  - `virtio_gpu_cmd_resource_flush_handler` → `window_flush_sw` → SDL_CondSignal
  - `window_thread` 收到訊號 → `SDL_CreateRGBSurfaceWithFormatFrom` → `SDL_RenderPresent`

- **鼠標處理**
  - `virtio_gpu_cmd_update_cursor_handler` → `cursor_update_sw` → SDL_CondSignal
  - `virtio_gpu_cmd_move_cursor_handler` → `cursor_move_sw` → SDL_CondSignal

## VirtIO-GPU 2D 運作流程

VirtIO-GPU 是一個基於 VirtIO 協定的虛擬圖形裝置，為 Guest OS 提供 GPU 功能。 本節以 semu 的實作為例，說明 VirtIO-GPU 2D 的運作流程，包含初始化、記憶體管理、指令處理以及畫面算繪等核心機制

### VirtIO-GPU 架構概述

VirtIO-GPU 在 semu 中採用分層設計，主要包含以下三個層次：

1. **VirtIO 層** (virtio-gpu.c)：處理 VirtIO 裝置的通用邏輯，包括裝置初始化、暫存器讀寫、VirtQueue 管理等
2. **GPU 指令處理層** (virtio-gpu-sw.c)：實作各種 GPU 指令的處理函式，如建立 2D 資源、綁定 scanout、flush 畫面等
3. **視窗後端層** (window-sw.c, window-events.c)：負責與 SDL 互動，處理實際的畫面算繪與事件輸入

### VirtIO-GPU 初始化流程

#### virtio_gpu_init

在 main.c 中，模擬器初始化時會呼叫 `virtio_gpu_init`：

```c
// main.c:905
emu->vgpu.ram = emu->ram;
virtio_gpu_init(&(emu->vgpu));
virtio_gpu_add_scanout(&(emu->vgpu), 1024, 768);
g_window.window_init();
```

`virtio_gpu_init` 定義於 virtio-gpu.c:696，其作用為初始化 VirtIO-GPU 裝置的私有資料結構：

```c
void virtio_gpu_init(virtio_gpu_state_t *vgpu)
{
    memset(&virtio_gpu_data, 0, sizeof(virtio_gpu_data_t));
    vgpu->priv = &virtio_gpu_data;
}
```

這裡將 `virtio_gpu_data_t` 清空並指派給 `vgpu->priv`，該結構記錄了所有 scanout 的資訊（寬度、高度、啟用狀態）

#### virtio_gpu_add_scanout

接著呼叫 `virtio_gpu_add_scanout` 來新增一個 scanout（顯示輸出），定義於 virtio-gpu.c:702：

```c
void virtio_gpu_add_scanout(virtio_gpu_state_t *vgpu,
                            uint32_t width,
                            uint32_t height)
{
    int scanout_num = vgpu_configs.num_scanouts;

    // 檢查是否超過最大 scanout 數量
    if (scanout_num >= VIRTIO_GPU_MAX_SCANOUTS) {
        fprintf(stderr, "%s(): exceeded scanout maximum number\n", __func__);
        exit(2);
    }

    // 設定 scanout 的屬性
    PRIV(vgpu)->scanouts[scanout_num].width = width;
    PRIV(vgpu)->scanouts[scanout_num].height = height;
    PRIV(vgpu)->scanouts[scanout_num].enabled = 1;

    // 通知視窗後端新增視窗
    g_window.window_add(width, height);

    vgpu_configs.num_scanouts++;
}
```

此函式會呼叫 `window_add_sw`（定義於 window-sw.c:155），該函式會記錄 display 的寬高資訊，但不會立即建立 SDL 視窗，而是等到 `window_init_sw` 被呼叫時才會建立

#### window_init_sw

`window_init_sw` 定義於 window-sw.c:138，負責初始化 SDL 並為每個 scanout 建立對應的視窗執行緒：

```c
void window_init_sw(void)
{
    // 初始化 SDL 視訊子系統
    if (SDL_Init(SDL_INIT_VIDEO) < 0) {
        fprintf(stderr, "%s(): failed to initialize SDL\n", __func__);
        exit(2);
    }

    // 為每個 display 建立執行緒
    for (int i = 0; i < display_cnt; i++) {
        displays[i].img_mtx = SDL_CreateMutex();
        displays[i].img_cond = SDL_CreateCond();

        displays[i].win_thread =
            SDL_CreateThread(window_thread, NULL, (void *) &displays[i]);
        SDL_DetachThread(displays[i].win_thread);
    }
}
```

每個 `window_thread` 會建立 SDL 視窗和 renderer，並進入一個無窮迴圈等待算繪請求

### VirtIO 暫存器讀寫

Guest OS 透過 MMIO 與 VirtIO-GPU 裝置互動，當 Guest 執行 load/store 指令存取 VirtIO-GPU 的記憶體區域時，會觸發 `virtio_gpu_read` 或 `virtio_gpu_write`

#### virtio_gpu_read

定義於 virtio-gpu.c:652，負責處理暫存器讀取：

```c
void virtio_gpu_read(hart_t *vm,
                     virtio_gpu_state_t *vgpu,
                     uint32_t addr,
                     uint8_t width,
                     uint32_t *value)
{
    switch (width) {
    case RV_MEM_LW:
        if (!virtio_gpu_reg_read(vgpu, addr >> 2, value))
            vm_set_exception(vm, RV_EXC_LOAD_FAULT, vm->exc_val);
        break;
    // ... 其他寬度的處理
    }
}
```

實際讀取邏輯在 `virtio_gpu_reg_read`（virtio-gpu.c:488），該函式根據暫存器位址回傳對應的值，例如：

- `VIRTIO_MagicValue`：回傳 0x74726976（"virt"）
- `VIRTIO_DeviceID`：回傳 16（GPU 裝置編號）
- `VIRTIO_DeviceFeatures`：回傳支援的功能位元（如 EDID 支援）
- `VIRTIO_Config`：回傳 GPU 設定，如 scanout 數量

#### virtio_gpu_write

定義於 virtio-gpu.c:675，負責處理暫存器寫入：

```c
void virtio_gpu_write(hart_t *vm,
                      virtio_gpu_state_t *vgpu,
                      uint32_t addr,
                      uint8_t width,
                      uint32_t value)
{
    switch (width) {
    case RV_MEM_SW:
        if (!virtio_gpu_reg_write(vgpu, addr >> 2, value))
            vm_set_exception(vm, RV_EXC_STORE_FAULT, vm->exc_val);
        break;
    // ... 其他寬度的處理
    }
}
```

`virtio_gpu_reg_write`（virtio-gpu.c:566）會根據暫存器位址執行不同操作，其中要注意在 `VIRTIO_QueueNotify` 的情況下，Guest 寫入此暫存器表示有新的指令需要處理，因此會呼叫 `virtio_queue_notify_handler`

### VirtQueue 處理流程

#### virtio_queue_notify_handler

定義於 virtio-gpu.c:427，當 Guest 通知有新指令時被呼叫：

```c
static void virtio_queue_notify_handler(virtio_gpu_state_t *vgpu, int index)
{
    uint32_t *ram = vgpu->ram;
    virtio_gpu_queue_t *queue = &vgpu->queues[index];

    // 檢查裝置狀態
    if (vgpu->Status & VIRTIO_STATUS__DEVICE_NEEDS_RESET)
        return;

    if (!((vgpu->Status & VIRTIO_STATUS__DRIVER_OK) && queue->ready))
        return virtio_gpu_set_fail(vgpu);

    // 檢查新的 available buffers
    uint16_t new_avail = ram[queue->QueueAvail] >> 16;
    if (new_avail - queue->last_avail > (uint16_t) queue->QueueNum)
        return (fprintf(stderr, "%s(): size check failed\n", __func__),
                virtio_gpu_set_fail(vgpu));

    if (queue->last_avail == new_avail)
        return;

    // 處理每一個可用的 buffer
    uint16_t new_used = ram[queue->QueueUsed] >> 16;
    while (queue->last_avail != new_avail) {
        uint16_t queue_idx = queue->last_avail % queue->QueueNum;
        uint16_t buffer_idx = ram[queue->QueueAvail + 1 + queue_idx / 2] >>
                              (16 * (queue_idx % 2));

        // 處理 descriptor
        uint32_t len = 0;
        int result = virtio_gpu_desc_handler(vgpu, queue, buffer_idx, &len);
        if (result != 0)
            return virtio_gpu_set_fail(vgpu);

        // 將結果寫回 used queue
        uint32_t vq_used_addr =
            queue->QueueUsed + 1 + (new_used % queue->QueueNum) * 2;
        ram[vq_used_addr] = buffer_idx;  /* virtq_used_elem.id */
        ram[vq_used_addr + 1] = len;     /* virtq_used_elem.len */
        queue->last_avail++;
        new_used++;
    }

    // 更新 used queue index
    vgpu->ram[queue->QueueUsed] &= MASK(16);
    vgpu->ram[queue->QueueUsed] |= ((uint32_t) new_used) << 16;

    // 發送中斷（除非設定 VIRTQ_AVAIL_F_NO_INTERRUPT）
    if (!(ram[queue->QueueAvail] & 1))
        vgpu->InterruptStatus |= VIRTIO_INT__USED_RING;
}
```

此函式會從 available queue 中取出 descriptor，並呼叫 `virtio_gpu_desc_handler` 處理

#### virtio_gpu_desc_handler

定義於 virtio-gpu.c:361，負責解析 descriptor chain 並分發指令：

```c
static int virtio_gpu_desc_handler(virtio_gpu_state_t *vgpu,
                                   const virtio_gpu_queue_t *queue,
                                   uint32_t desc_idx,
                                   uint32_t *plen)
{
    struct virtq_desc vq_desc[3];

    // 收集 descriptor chain（最多 3 個）
    for (int i = 0; i < 3; i++) {
        uint32_t *desc = &vgpu->ram[queue->QueueDesc + desc_idx * 4];
        vq_desc[i].addr = desc[0];
        vq_desc[i].len = desc[2];
        vq_desc[i].flags = desc[3];
        desc_idx = desc[3] >> 16;

        if (!(vq_desc[i].flags & VIRTIO_DESC_F_NEXT))
            break;
    }

    // 取得指令 header
    struct vgpu_ctrl_hdr *header =
        vgpu_mem_guest_to_host(vgpu, vq_desc[0].addr);

    // 根據指令類型分發處理
    switch (header->type) {
        VGPU_CMD(GET_DISPLAY_INFO, get_display_info)
        VGPU_CMD(RESOURCE_CREATE_2D, resource_create_2d)
        VGPU_CMD(RESOURCE_UNREF, resource_unref)
        VGPU_CMD(SET_SCANOUT, set_scanout)
        VGPU_CMD(RESOURCE_FLUSH, resource_flush)
        VGPU_CMD(TRANSFER_TO_HOST_2D, trasfer_to_host_2d)
        VGPU_CMD(RESOURCE_ATTACH_BACKING, resource_attach_backing)
        // ... 其他指令
    default:
        virtio_gpu_cmd_undefined_handler(vgpu, vq_desc, plen);
        break;
    }

    return 0;
}
```

`VGPU_CMD` 巨集會展開為呼叫 `g_vgpu_backend` 中對應的處理函式

### 2D 資源管理

#### vgpu_create_resource_2d

定義於 virtio-gpu.c:99，用於建立新的 2D resource：

```c
struct vgpu_resource_2d *vgpu_create_resource_2d(int resource_id)
{
    struct vgpu_resource_2d *res = malloc(sizeof(struct vgpu_resource_2d));
    if (!res)
        return NULL;

    memset(res, 0, sizeof(*res));
    res->resource_id = resource_id;
    list_push(&res->list, &vgpu_res_2d_list);
    return res;
}
```

當 host 端收到 `VIRTIO_GPU_CMD_RESOURCE_CREATE_2D` 命令時會間接呼叫此函式，此時：

- 在 semu 裡會配置/初始化一個 `struct vgpu_resource_2d`，放進 `vgpu_res_2d_list`，以 `resource_id` 作 key
- 這個內部物件是 host-private 的實作細節，guest 看不到其位址，也不能直接讀寫它的欄位

Guest 端在協定層只擁有：

- `resource_id`（一個 32-bit 整數 handle）
- 以及它自己分配的 backing storage（像素所在的 guest RAM）
- 並透過 controlq 發送命令去操作該 `resource_id` 對應的資源：
	- `RESOURCE_ATTACH_BACKING`
	- `TRANSFER_TO_HOST_2D`
	- `SET_SCANOUT`
	- `RESOURCE_FLUSH`
	- `RESOURCE_UNREF`
	- 等等

#### vgpu_get_resource_2d

定義於 virtio-gpu.c:111，根據 resource ID 查找對應的資源：

```c
struct vgpu_resource_2d *vgpu_get_resource_2d(uint32_t resource_id)
{
    struct vgpu_resource_2d *res_2d;
    list_for_each_entry (res_2d, &vgpu_res_2d_list, list) {
        if (res_2d->resource_id == resource_id)
            return res_2d;
    }
    return NULL;
}
```

此函式會在各種需要存取 resource 的指令處理函式中被呼叫

#### vgpu_destory_resource_2d

定義於 virtio-gpu.c:122，用於銷毀 2D resource：

```c
int vgpu_destory_resource_2d(uint32_t resource_id)
{
    struct vgpu_resource_2d *res_2d = vgpu_get_resource_2d(resource_id);

    if (!res_2d)
        return -1;

    // 釋放資源
    free(res_2d->image);
    list_del(&res_2d->list);
    free(res_2d->iovec);
    free(res_2d);

    return 0;
}
```

此函式被 `virtio_gpu_cmd_resource_unref_handler` 呼叫

### GPU 指令處理

所有的 GPU 指令處理函式都定義在 virtio-gpu-sw.c 中，並透過 `g_vgpu_backend` 結構體註冊（virtio-gpu-sw.c:365）

#### VIRTIO_GPU_CMD_GET_DISPLAY_INFO

`virtio_gpu_get_display_info_handler` 定義於 virtio-gpu.c:212，回傳顯示器資訊：

```c
void virtio_gpu_get_display_info_handler(virtio_gpu_state_t *vgpu,
                                         struct virtq_desc *vq_desc,
                                         uint32_t *plen)
{
    struct vgpu_resp_disp_info *response =
        vgpu_mem_guest_to_host(vgpu, vq_desc[1].addr);

    memset(response, 0, sizeof(*response));
    response->hdr.type = VIRTIO_GPU_RESP_OK_DISPLAY_INFO;

    // 填寫每個 scanout 的資訊
    int scanout_num = vgpu_configs.num_scanouts;
    for (int i = 0; i < scanout_num; i++) {
        response->pmodes[i].r.width = PRIV(vgpu)->scanouts[i].width;
        response->pmodes[i].r.height = PRIV(vgpu)->scanouts[i].height;
        response->pmodes[i].enabled = PRIV(vgpu)->scanouts[i].enabled;
    }

    *plen = sizeof(*response);
}
```

此函式在 Guest OS 查詢顯示器資訊時被呼叫，其中 `vgpu_resp_disp_info` 的定義為：

```c
PACKED(struct vgpu_resp_disp_info {
    struct vgpu_ctrl_hdr hdr;
    struct virtio_gpu_display_one {
        struct vgpu_rect r;
        uint32_t enabled;
        uint32_t flags;
    } pmodes[VIRTIO_GPU_MAX_SCANOUTS];
});
```

對應到 spec 裡面的 `virtio_gpu_display_one`

#### VIRTIO_GPU_CMD_RESOURCE_CREATE_2D

`virtio_gpu_resource_create_2d_handler` 定義於 virtio-gpu-sw.c:13，用於建立 2D resource：

```c
static void virtio_gpu_resource_create_2d_handler(virtio_gpu_state_t *vgpu,
                                                  struct virtq_desc *vq_desc,
                                                  uint32_t *plen)
{
    // 讀取請求
    struct vgpu_res_create_2d *request =
        vgpu_mem_guest_to_host(vgpu, vq_desc[0].addr);

    // Resource ID 不能為 0
    if (request->resource_id == 0) {
        *plen = virtio_gpu_write_response(
            vgpu, vq_desc[1].addr, VIRTIO_GPU_RESP_ERR_INVALID_RESOURCE_ID);
        return;
    }

    // 建立 2D resource
    struct vgpu_resource_2d *res_2d =
        vgpu_create_resource_2d(request->resource_id);

    // 根據格式設定 bits_per_pixel
    uint32_t bits_per_pixel;
    switch (request->format) {
    case VIRTIO_GPU_FORMAT_B8G8R8A8_UNORM:
        bits_per_pixel = 32;
        break;
    // ... 其他格式
    }

    uint32_t bytes_per_pixel = bits_per_pixel / 8;

    // 設定 resource 屬性
    res_2d->width = request->width;
    res_2d->height = request->height;
    res_2d->format = request->format;
    res_2d->bits_per_pixel = bits_per_pixel;
    res_2d->stride = request->width * (bits_per_pixel / 8);
    res_2d->image = malloc(res_2d->stride * request->height);

    // 回傳成功
    *plen = virtio_gpu_write_response(vgpu, vq_desc[1].addr,
                                      VIRTIO_GPU_RESP_OK_NODATA);
    virtio_gpu_set_response_fencing(vgpu, &request->hdr, vq_desc[1].addr);
}
```

此函式會分配 host 端的圖像 buffer（`res_2d->image`），用於存放實際的像素資料

#### VIRTIO_GPU_CMD_RESOURCE_ATTACH_BACKING

在 VirtIO-GPU 的設計中，有兩個分離的概念：

1. Resource（資源）：一個 2D 圖像資源的 metadata
    - 由 `RESOURCE_CREATE_2D` 建立
    - 有寬度、高度、格式等屬性
    - 但還沒有實際的記憶體來存放像素資料
2. Backing Storage（後端儲存）：實際存放像素資料的記憶體
    - Guest OS 分配的記憶體頁面
    - 透過 `RESOURCE_ATTACH_BACKING` 附加到 resource

`virtio_gpu_cmd_resource_attach_backing_handler` 定義於 virtio-gpu-sw.c:265，用於將 Guest 記憶體附加到 resource：

```c
static void virtio_gpu_cmd_resource_attach_backing_handler(
    virtio_gpu_state_t *vgpu,
    struct virtq_desc *vq_desc,
    uint32_t *plen)
{
    // 讀取請求
    struct vgpu_res_attach_backing *backing_info =
        vgpu_mem_guest_to_host(vgpu, vq_desc[0].addr);
    struct vgpu_mem_entry *pages =
        vgpu_mem_guest_to_host(vgpu, vq_desc[1].addr);

    // 取得 resource
    struct vgpu_resource_2d *res_2d =
        vgpu_get_resource_2d(backing_info->resource_id);
    if (!res_2d) {
        fprintf(stderr, "%s(): invalid resource id %d\n", __func__,
                backing_info->resource_id);
        *plen = virtio_gpu_write_response(
            vgpu, vq_desc[2].addr, VIRTIO_GPU_RESP_ERR_INVALID_RESOURCE_ID);
        return;
    }
    
    // 分配 iovec 陣列
    res_2d->page_cnt = backing_info->nr_entries;
    res_2d->iovec = malloc(sizeof(struct iovec) * backing_info->nr_entries);
    if (!res_2d->iovec) {
        fprintf(stderr, "%s(): failed to allocate io vector\n", __func__);
        virtio_gpu_set_fail(vgpu);
        return;
    }
    
    // 將每個 Guest 記憶體頁的位址轉換為 Host 位址
    struct vgpu_mem_entry *mem_entries = (struct vgpu_mem_entry *) pages;
    for (size_t i = 0; i < backing_info->nr_entries; i++) {
        res_2d->iovec[i].iov_base =
            vgpu_mem_guest_to_host(vgpu, mem_entries[i].addr);
        res_2d->iovec[i].iov_len = mem_entries[i].length;
    }

    *plen = virtio_gpu_write_response(vgpu, vq_desc[2].addr,
                                      VIRTIO_GPU_RESP_OK_NODATA);
    virtio_gpu_set_response_fencing(vgpu, &backing_info->hdr, vq_desc[2].addr);
}
```

此函式將 Guest 提供的記憶體頁記錄到 `res_2d->iovec`，後續 transfer 操作會從這些頁中讀取像素資料

- `backing_info`：包含 `resource_id` 和 `nr_entries`（頁面數量）
- `pages`：一個陣列，每個元素描述一個 guest memory 頁面

其中

- `struct vgpu_res_attach_backing` 等價於規格的 `struct virtio_gpu_resource_attach_backing`
- `struct vgpu_mem_entry[]` 等價於規格的 `struct virtio_gpu_mem_entry`

定義如下：

```c
PACKED(struct vgpu_res_attach_backing {
    struct vgpu_ctrl_hdr hdr;
    uint32_t resource_id;    // 要附加到哪個 resource
    uint32_t nr_entries;     // 有多少個記憶體頁面
});

PACKED(struct vgpu_mem_entry {
    uint64_t addr;           // Guest 記憶體位址
    uint32_t length;         // 這個頁面的大小
    uint32_t padding;
});
```

#### VIRTIO_GPU_CMD_TRANSFER_TO_HOST_2D

`virtio_gpu_cmd_transfer_to_host_2d_handler` 定義於 virtio-gpu-sw.c:216，用於將 Guest 記憶體的像素資料傳輸到 Host：

```c
static void virtio_gpu_cmd_transfer_to_host_2d_handler(
    virtio_gpu_state_t *vgpu,
    struct virtq_desc *vq_desc,
    uint32_t *plen)
{
    // 讀取請求
    struct vgpu_trans_to_host_2d *req =
        vgpu_mem_guest_to_host(vgpu, vq_desc[0].addr);

    // 取得 resource
    struct vgpu_resource_2d *res_2d = vgpu_get_resource_2d(req->resource_id);
    if (!res_2d) {
        fprintf(stderr, "%s(): invalid resource id %d\n", __func__,
                req->resource_id);
        *plen = virtio_gpu_write_response(
            vgpu, vq_desc[1].addr, VIRTIO_GPU_RESP_ERR_INVALID_RESOURCE_ID);
        return;
    }

    // 檢查邊界
    if (req->r.x > res_2d->width || req->r.y > res_2d->height ||
        req->r.width > res_2d->width || req->r.height > res_2d->height ||
        req->r.x + req->r.width > res_2d->width ||
        req->r.y + req->r.height > res_2d->height) {
        *plen = virtio_gpu_write_response(
            vgpu, vq_desc[1].addr, VIRTIO_GPU_RESP_ERR_INVALID_PARAMETER);
        return;
    }

    uint32_t width =
        (req->r.width < res_2d->width) ? req->r.width : res_2d->width;
    uint32_t height =
        (req->r.height < res_2d->height) ? req->r.height : res_2d->height;

    // 傳輸圖像資料
    if (width == CURSOR_WIDTH && height == CURSOR_HEIGHT)
        virtio_gpu_cursor_image_copy(res_2d);
    else
        virtio_gpu_copy_image_from_pages(req, res_2d);

    *plen = virtio_gpu_write_response(vgpu, vq_desc[1].addr,
                                      VIRTIO_GPU_RESP_OK_NODATA);
    virtio_gpu_set_response_fencing(vgpu, &req->hdr, vq_desc[1].addr);
}
```

此函式會呼叫 `virtio_gpu_copy_image_from_pages`（virtio-gpu-sw.c:184），逐行從 Guest 記憶體複製像素資料到 `res_2d->image`

其中 `vgpu_trans_to_host_2d` 對應到規格中的 `virtio_gpu_transfer_to_host_2d`，定義為

```c
PACKED(struct vgpu_trans_to_host_2d {
    struct vgpu_ctrl_hdr hdr;
    struct vgpu_rect r;      // 要傳輸的矩形區域 (x, y, width, height)
    uint64_t offset;         // Guest backing storage 的偏移量
    uint32_t resource_id;    // 目標 resource ID
    uint32_t padding;
});
```

##### `virtio_gpu_copy_image_from_pages`

這個函式是 `virtio_gpu_cmd_transfer_to_host_2d_handler` 的核心部分，用來將圖像資料從 guest OS 的記憶體頁面（scatter-gather iovec）複製到 host 的資源緩衝區

```c
static void virtio_gpu_copy_image_from_pages(struct vgpu_trans_to_host_2d *req,
                                             struct vgpu_resource_2d *res_2d)
{
    uint32_t stride = res_2d->stride;          // 每一列的位元組數（寬度 × 每像素位元組）
    uint32_t bpp = res_2d->bits_per_pixel / 8; // Bytes per pixel (例如 RGBA32 = 4)

    // 最小寬度與高度
    uint32_t width =
        (req->r.width < res_2d->width) ? req->r.width : res_2d->width;
    uint32_t height =
        (req->r.height < res_2d->height) ? req->r.height : res_2d->height;
    void *img_data = (void *) res_2d->image;

    /* Copy image by row */
    for (uint32_t h = 0; h < height; h++) {
        /* Note that source offset is in the image coordinate. The address to
         * copy from is the page base address plus with the offset
         */
        size_t src_offset = req->offset + stride * h;
        size_t dest_offset = (req->r.y + h) * stride + (req->r.x * bpp);
        void *dest = (void *) ((uintptr_t) img_data + dest_offset);
        size_t total = width * bpp;

        iov_to_buf(res_2d->iovec, res_2d->page_cnt, src_offset, dest, total);
    }
}
```

其中參數的部分為：

- `req`：guest 傳來的傳輸請求，包含要傳輸的矩形區域資訊（x、y、width、height）與 offset
- `res_2d`：host 端的 2d 資源，包含完整的 framebuffer（`image` 指標）和 guest memory pages（`iovec`）

注意 `TRANSFER_TO_HOST_2D` 這個命令允許只更新（transfer）framebuffer/resource 的一個矩形子區域（dirty rectangle），而不是每次都搬整張 buffer

在 DRM/KMS 裡，非 tiled 的情況下可以把 framebuffer 的儲存方式理解為一個邏輯上的一維陣列（不保證物理連續），因此在 kernel 中需要 `pitch` 與 `offsets` 這兩個參數來把 2D 座標對應到 1D 位址

- `pitch`（或稱為 stride）：同一個 plane 中，相鄰兩列（row）的起點在記憶體中相差多少 bytes
  - 等價地說：記憶體中每一列實際佔用了多少 bytes（包含列尾端的 padding）
  - 第 `y` 列的起點位址：`base + y * pitch`
  - 下一列 `y+1` 的起點位址：`base + (y+1) * pitch`
  - 硬體/driver 通常會要求每列起點要做對齊（例如 64/128/256 bytes 對齊），所以一列末端會有 padding
  - 在 kernel 中為 `drm_framebuffer` 結構體的成員：
    ```c
    /**
    * @pitches: Line stride per buffer. For userspace created object this
    * is copied from drm_mode_fb_cmd2.
    */
    unsigned int pitches[DRM_FORMAT_MAX_PLANES];
    ```
- `offsets`：從該 plane 所在 buffer object（BO）為起點，到「該 plane 的第一個有效像素資料」的 byte offset
  - 因此 
    ```
    實體記憶體位址 = GEM object 基底位址 (dma_addr)
                  + plane 偏移 (fb->offsets[plane])
                  + Y 座標偏移 (fb->pitches[plane] * y)
                  + X 座標偏移 (fb->format->cpp[plane] * x)
    ```
  - 跟我們程式碼中的 offset 語意不同，我們用不到，kernel 送請求過來時就處理好了

`virtio_gpu_copy_image_from_pages` 中的 for loop 用來逐 row 複製圖像資料，參考了 [QEMU 的實作](https://github.com/qemu/qemu/blob/master/hw/display/virtio-gpu.c#L473)

其中，對於 `src_offset = req->offset + stride * h;` 的部分：

- `req->offset`：guest 傳來的起始偏移量（這次搬運從 backing store 的哪個 byte 開始）
  - 可以視為 `req->offset = fb->offsets[0] + y * fb->pitches[0] + x * fb->format->cpp[0]`
    - `fb->offsets[0]`：plane base（dumb BO 會是 0）
    - `y * pitches[0]`：往下走 `y` 列（每列 `pitch` bytes）
    - `x * cpp[0]`：往右走 `x` 個像素（每像素 `cpp` bytes）
    - kernel code：
      ```c
      static void virtio_gpu_update_dumb_bo(struct virtio_gpu_device *vgdev,
                    struct drm_plane_state *state,
                    struct drm_rect *rect)
      {
        struct virtio_gpu_object *bo =
          gem_to_virtio_gpu_obj(state->fb->obj[0]);
        struct virtio_gpu_object_array *objs;
        uint32_t w = rect->x2 - rect->x1;
        uint32_t h = rect->y2 - rect->y1;
        uint32_t x = rect->x1;
        uint32_t y = rect->y1;
        uint32_t off = x * state->fb->format->cpp[0] +
          y * state->fb->pitches[0];

        objs = virtio_gpu_array_alloc(1);
        if (!objs)
          return;
        virtio_gpu_array_add_obj(objs, &bo->base.base);

        virtio_gpu_cmd_transfer_to_host_2d(vgdev, off, w, h, x, y,
                  objs, NULL);
      }
      ```
- `stride*h`：每往下一行，偏移量就會增加一個完整的 stride
- 因此 `req->offset + stride * h;` 表示第 h 個 row 的起始位址

而對於 `dest_offset = (req->r.y + h) * stride + (req->r.x * bpp);` 的部分：

- `(req->r.y + h)`：目標 Y 座標 + 當前行數
- `* stride`：轉換成位元組偏移
- `+ (req->r.x * bpp)`：加上 X 座標的偏移
- 理論上值會等於 `src_dest`（`stride` 的值相同）
  - 我也不確定為什麼要算兩次，想到的只有為了表明
    - `src_offset`：來源 backing（pages/iovec） 的「讀取起點」
    - `dest_offset`：目的 image（res_2d->image） 的「寫入起點」

    這件事而已
  - 最後把偏移量加上 base（`img_data`）就可以得到寫入起點位址了

#### VIRTIO_GPU_CMD_SET_SCANOUT

`virtio_gpu_cmd_set_scanout_handler` 定義於 virtio-gpu-sw.c:123，用於將 resource 綁定到 scanout：

```c
static void virtio_gpu_cmd_set_scanout_handler(virtio_gpu_state_t *vgpu,
                                               struct virtq_desc *vq_desc,
                                               uint32_t *plen)
{
    // 讀取請求
    struct vgpu_set_scanout *request =
        vgpu_mem_guest_to_host(vgpu, vq_desc[0].addr);

    // Resource ID 為 0 表示停止顯示
    if (request->resource_id == 0) {
        g_window.window_clear(request->scanout_id);
        goto leave;
    }

    // 取得 resource
    struct vgpu_resource_2d *res_2d =
        vgpu_get_resource_2d(request->resource_id);

    // 綁定 scanout 與 resource
    res_2d->scanout_id = request->scanout_id;

leave:
    *plen = virtio_gpu_write_response(vgpu, vq_desc[1].addr,
                                      VIRTIO_GPU_RESP_OK_NODATA);
}
```

此指令會將 resource 與特定的 scanout 關聯，後續 flush 操作會將該 resource 的內容顯示在對應的視窗上

#### VIRTIO_GPU_CMD_RESOURCE_FLUSH

`virtio_gpu_cmd_resource_flush_handler` 定義於 virtio-gpu-sw.c:157，用於將 resource 的內容顯示到螢幕：

```c
static void virtio_gpu_cmd_resource_flush_handler(virtio_gpu_state_t *vgpu,
                                                  struct virtq_desc *vq_desc,
                                                  uint32_t *plen)
{
    // 讀取請求
    struct vgpu_res_flush *request =
        vgpu_mem_guest_to_host(vgpu, vq_desc[0].addr);

    // 取得 resource
    struct vgpu_resource_2d *res_2d =
        vgpu_get_resource_2d(request->resource_id);

    // 觸發顯示更新
    g_window.window_flush(res_2d->scanout_id, request->resource_id);

    *plen = virtio_gpu_write_response(vgpu, vq_desc[1].addr,
                                      VIRTIO_GPU_RESP_OK_NODATA);
}
```

此函式會呼叫 `window_flush_sw`，將圖像資料傳送給視窗執行緒進行算繪

### 視窗算繪機制

#### window_flush_sw

定義於 window-sw.c:303，負責將 resource 的圖像資料傳送給視窗執行緒：

```c
static void window_flush_sw(int scanout_id, int res_id)
{
    struct display_info *display = &displays[scanout_id];
    struct vgpu_resource_2d *resource = vgpu_get_resource_2d(res_id);

    // 將 virtio-gpu 的像素格式轉換成 SDL 的像素格式
    uint32_t sdl_format;
    bool legal_format = virtio_gpu_to_sdl_format(resource->format, &sdl_format);
    if (!legal_format) {
        fprintf(stderr, "%s(): invalid resource format\n", __func__);
        return;
    }

    // 進入臨界區
    window_lock_mutex(scanout_id);

    // 更新 primary plane 資源
    display->primary_sdl_format = sdl_format;
    memcpy(&display->resource, resource, sizeof(struct vgpu_resource_2d));

    // 觸發算繪
    display->render_type = FLUSH_PRIMARY_PLANE;
    SDL_CondSignal(display->img_cond);

    // 離開臨界區
    window_unlock_mutex(scanout_id);
}
```

此函式將 resource 資料複製到 `display->resource`，並設定 `render_type` 為 `FLUSH_PRIMARY_PLANE`，然後喚醒視窗執行緒

如同開頭說的，這邊的 `memcpy` 主要做的是 shallow copy，`display->resource` 與 `resource` 兩者內部的 `image`、`iovec` 與 `list` 等指標都還是指向相同的記憶體區塊。 但如 `width` 這種 metadata 就是很一般的複製進去為複本了

#### window_thread

定義於 window-sw.c:45，是視窗執行緒的主迴圈：

```c
static int window_thread(void *data)
{
    struct display_info *display = (struct display_info *) data;
    struct vgpu_resource_2d *resource = &display->resource;
    struct vgpu_resource_2d *cursor = &display->cursor;

    // 建立 SDL 視窗
    display->window = SDL_CreateWindow("semu", SDL_WINDOWPOS_UNDEFINED,
                                       SDL_WINDOWPOS_UNDEFINED, resource->width,
                                       resource->height, SDL_WINDOW_SHOWN);

    // 建立 SDL renderer
    display->renderer =
        SDL_CreateRenderer(display->window, -1, SDL_RENDERER_ACCELERATED);

    // 清除畫面為黑色
    SDL_SetRenderDrawColor(display->renderer, 0, 0, 0, 255);
    SDL_RenderClear(display->renderer);
    SDL_RenderPresent(display->renderer);

    // 建立事件處理執行緒
    ((struct display_info *) data)->ev_thread =
        SDL_CreateThread(window_events_thread, NULL, data);

    SDL_Surface *surface;

    while (1) {
        SDL_LockMutex(display->img_mtx);
        // 等待算繪請求
        while (SDL_CondWaitTimeout(display->img_cond, display->img_mtx,
                                   SDL_COND_TIMEOUT))
            ;

        // 根據 render_type 處理
        if (display->render_type == CLEAR_PRIMARY_PLANE) {
            SDL_SetRenderDrawColor(display->renderer, 0, 0, 0, 255);
        } else if (display->render_type == FLUSH_PRIMARY_PLANE) {
            // 從圖像資料建立 SDL surface
            surface = SDL_CreateRGBSurfaceWithFormatFrom(
                resource->image, resource->width, resource->height,
                resource->bits_per_pixel, resource->stride,
                display->primary_sdl_format);

            // 建立 texture
            SDL_DestroyTexture(display->primary_texture);
            display->primary_texture =
                SDL_CreateTextureFromSurface(display->renderer, surface);
            SDL_FreeSurface(surface);
        } else if (display->render_type == UPDATE_CURSOR_PLANE) {
            // 處理鼠標更新
            // ...
        } else if (display->render_type == CLEAR_CURSOR_PLANE) {
            SDL_DestroyTexture(display->cursor_texture);
            display->cursor_texture = NULL;
        }

        // 算繪畫面
        SDL_RenderClear(display->renderer);
        if (display->primary_texture)
            SDL_RenderCopy(display->renderer, display->primary_texture, NULL, NULL);
        if (display->cursor_texture)
            SDL_RenderCopy(display->renderer, display->cursor_texture, NULL,
                           &display->cursor_rect);
        SDL_RenderPresent(display->renderer);

        SDL_UnlockMutex(display->img_mtx);
    }
}
```

視窗執行緒會不斷等待條件變數 `img_cond`，當收到訊號後根據 `render_type` 執行對應的算繪操作，最後呼叫 `SDL_RenderPresent` 將畫面顯示到螢幕

`window_flush_sw` 與 `window_thread` 這兩個函式是一起使用的，前者為生產者，後者為消費者：

- `window_flush_sw`（生產者）：
  - 準備好資料
  - 設置 `render_type = FLUSH_PRIMARY_PLANE`
  - 發送信號來喚醒算繪執行緒
- `window_thread`（消費者）：
  - 在迴圈中等待條件變數（`SDL_CondWaitTimeout`）
  - 收到信號後檢查 `render_type`
  - 如果是 `FLUSH_PRIMARY_PLANE`，則建立 SDL surface 與 texture
  - 最後將畫面輸出

### Cursor（鼠標）處理

VirtIO-GPU 支援硬體鼠標，允許 Guest OS 更新鼠標的圖像和位置

#### VIRTIO_GPU_CMD_UPDATE_CURSOR

`virtio_gpu_cmd_update_cursor_handler` 定義於 virtio-gpu-sw.c:320，用於更新鼠標：

```c
static void virtio_gpu_cmd_update_cursor_handler(virtio_gpu_state_t *vgpu,
                                                 struct virtq_desc *vq_desc,
                                                 uint32_t *plen)
{
    // 讀取請求
    struct virtio_gpu_update_cursor *cursor =
        vgpu_mem_guest_to_host(vgpu, vq_desc[0].addr);

    // 取得 cursor resource
    struct vgpu_resource_2d *res_2d = vgpu_get_resource_2d(cursor->resource_id);

    if (res_2d) {
        g_window.cursor_update(cursor->pos.scanout_id, cursor->resource_id,
                               cursor->pos.x, cursor->pos.y);
    } else if (cursor->resource_id == 0) {
        g_window.cursor_clear(cursor->pos.scanout_id);
    }

    *plen = virtio_gpu_write_response(vgpu, vq_desc[1].addr,
                                      VIRTIO_GPU_RESP_OK_NODATA);
}
```

此函式會呼叫 `cursor_update_sw`（window-sw.c:228），將鼠標資源複製到 display 的 cursor plane，並設定鼠標位置，然後觸發算繪

#### VIRTIO_GPU_CMD_MOVE_CURSOR

`virtio_gpu_cmd_move_cursor_handler` 定義於 virtio-gpu-sw.c:349，用於移動鼠標位置：

```c
static void virtio_gpu_cmd_move_cursor_handler(virtio_gpu_state_t *vgpu,
                                               struct virtq_desc *vq_desc,
                                               uint32_t *plen)
{
    // 讀取請求
    struct virtio_gpu_update_cursor *cursor =
        vgpu_mem_guest_to_host(vgpu, vq_desc[0].addr);

    // 移動鼠標
    g_window.cursor_move(cursor->pos.scanout_id, cursor->pos.x, cursor->pos.y);

    *plen = virtio_gpu_write_response(vgpu, vq_desc[1].addr,
                                      VIRTIO_GPU_RESP_OK_NODATA);
}
```

此函式會呼叫 `cursor_move_sw`（window-sw.c:270），更新鼠標位置並觸發算繪

### 輔助函式

#### vgpu_mem_guest_to_host

定義於 virtio-gpu.c:139，用於將 Guest 物理位址轉換為 Host 虛擬位址：

```c
void *vgpu_mem_guest_to_host(virtio_gpu_state_t *vgpu, uint32_t addr)
{
    return (void *) ((uintptr_t) vgpu->ram + addr);
}
```

- `vgpu->ram`：指向 guest RAM 在 host 記憶體空間中的起始位址
- `addr`：guest RAM 中的位址

由於模擬器的 RAM 是一塊連續的記憶體區域，因此只需將基底位址加上偏移即可，相加後就可以得到 host 能直接 dereference 的指標

#### iov_to_buf

定義於 virtio-gpu.c:56，用於從 scatter-gather 列表（iovec 陣列）複製資料到 buffer：

```c
size_t iov_to_buf(const struct iovec *iov,
                  const unsigned int iov_cnt,
                  size_t offset,
                  void *buf,
                  size_t bytes)
{
    size_t done = 0;

    for (unsigned int i = 0; i < iov_cnt; i++) {
        // 跳過空頁面
        if (iov[i].iov_base == 0 || iov[i].iov_len == 0)
            continue;

        if (offset < iov[i].iov_len) {
            // 計算可從當前頁面複製的資料量
            size_t remained = bytes - done;    // 還需要複製多少
            size_t page_avail = iov[i].iov_len - offset;    // 當前頁還有多少
            size_t len = (remained < page_avail) ? remained : page_avail;    // 取較小值

            // 複製到 buffer
            void *src = (void *) ((uintptr_t) iov[i].iov_base + offset);
            void *dest = (void *) ((uintptr_t) buf + done);
            memcpy(dest, src, len);

            // 下一頁從頭開始讀取
            offset = 0;
            done += len;

            if (done >= bytes)
                break;
        } else {
            offset -= iov[i].iov_len;
        }
    }

    return done;
}
```

- `iov`：iovec 陣列的指標，每個 iovec 描述一個記憶體區段
  - `iov[i].iov_base`：該區段的起始地址
  - `iov[i].iov_len`：該區段的長度
- `iov_cnt`：iovec 陣列的元素數量
- `offset`：從 iovec 陣列的哪個位置開始讀取（可能跨越多個 iovec）
- `buf`：目標緩衝區
- `bytes`：要複製的總位元組數

此函式在 `virtio_gpu_copy_image_from_pages` 中被使用，從分散不連續的 Guest 記憶體頁複製像素資料到連續的 Host buffer，被呼叫的形式如前所述：

```c
/* Copy image by row */
for (uint32_t h = 0; h < height; h++) {
    /* Note that source offset is in the image coordinate. The address to
      * copy from is the page base address plus with the offset
      */
    size_t src_offset = req->offset + stride * h;
    size_t dest_offset = (req->r.y + h) * stride + (req->r.x * bpp);
    void *dest = (void *) ((uintptr_t) img_data + dest_offset);
    size_t total = width * bpp;

    iov_to_buf(res_2d->iovec, res_2d->page_cnt, src_offset, dest, total);
}
```
