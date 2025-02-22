---
title: RISC-V ACLINT
date: 2024-12-11
mathjax: true
tag: risc-v
category: risc-v
---

# RISC-V ACLINT

- spec：https://github.com/riscv/riscv-aclint/blob/main/riscv-aclint.adoc

# Introduction

1. 功能
    :::spoiler 原文
    > This RISC-V ACLINT specification defines a set of memory mapped devices which provide inter-processor interrupts (IPI) and timer functionalities for each HART on a multi-HART RISC-V platform.
    :::

    ACLINT 是一組 memory mapped devices，用於在 multi-hart 的 RISC-V 平台上提供

    - inter-processor interrupts (IPI)
    - 定時器功能 (Timer functionalities)

2. CLINT 的局限性
    :::spoiler 原文
    > The SiFive Core-Local Interruptor (CLINT) device has been widely adopted in the RISC-V world to provide machine-level IPI and timer functionalities.
    >
    > Unfortunately, the SiFive CLINT has a unified register map for both IPI and timer functionalities and it does not provide supervisor-level IPI functionality.
    :::

    - CLINT 在 RISC-V 平台上廣泛用於提供 Machine-level 的 IPI 和定時器功能
    - 局限性
      - unified register map
        - CLINT 將 IPI 和定時器功能的暫存器放在一個統一的地址空間中
      - 缺乏 supervisor-level IPI

3. ACLINT 的改進
    :::spoiler 原文
    > The RISC-V ACLINT specification takes a more modular approach by defining separate memory mapped devices for IPI and timer functionalities.
    > 
    > This modularity allows RISC-V platforms to omit some of the RISC-V ACLINT devices for when the platform has an alternate mechanism.
    > 
    > In addition to modularity, the RISC-V ACLINT specification also defines a dedicated memory mapped device for supervisor-level IPIs.
    :::

    - modularity
      - ACLINT 將 IPI 和定時器功能分別定義為獨立的 memory mapped device
      - 如果平台有替代機制，可以選擇性地省略部分 ACLINT 設備
    - 另外 ACLINT 定義了專門的 memory mapped device 來支持 supervisor-level IPI，填補了 CLINT 的功能空缺

4. ACLINT Devices
    | Name   | Privilege Level | Functionality |
    | - | - | - |
    | MTIMER | Machine         | Fixed-frequency counter and timer events |
    | MSWI   | Machine         | Inter-processor (or software) interrupts |
    | SSWI   | Supervisor      | Inter-processor (or software) interrupts |

5. 與 SiFive CLINT 的兼容性
    :::spoiler 原文
    > The RISC-V ACLINT specification is defined to be backward compatible with the SiFive CLINT specification.
    > 
    > The register definitions and register offsets of the MTIMER and MSWI devices are compatible with the timer and IPI registers defined by the SiFive CLINT specification.
    :::

    - ACLINT 的 MTIMER 和 MSWI 設備的暫存器定義和偏移量與 SiFive CLINT 中的定時器和 IPI 暫存器保持一致

6. CLINT 與 ACLINT 的邏輯關係

    SiFive CLINT 設備可以被邏輯地視為兩個 ACLINT 設備的組合

    | SiFive CLINT Offset Range | ACLINT Device | Functionality |
    | - | - | - |
    | 0x0000_0000 - 0x0000_3fff | MSWI          | Machine-level inter-processor (or software) interrupts |
    | 0x0000_4000 - 0x0000_bfff | MTIMER        | Machine-level fixed-frequency counter and timer events |

    - MSWI：對應 CLINT 地址範圍 0x0000_0000 - 0x0000_3fff，提供 Machine-level  IPI
    - MTIMER：對應 CLINT 地址範圍 0x0000_4000 - 0x0000_bfff，提供 Machine-level 定時器功能

# Machine-level Timer Device (MTIMER)

## Introduction

:::spoiler 原文
> The MTIMER device provides machine-level timer functionality for a set of HARTs on a RISC-V platform.
> 
> It has a single fixed-frequency monotonic time counter (`MTIME`) register and a time compare register (`MTIMECMP`) for each HART connected to the MTIMER device.
> 
> A MTIMER device not connected to any HART should only have a `MTIME` register and no `MTIMECMP` registers.
:::

- MTIMER 為一組 HART 提供 Machine-level 的定時器功能，用於支持計時和產生定時器中斷
- `MTIME` Register 
  - 每個 HART 有一個對應的 `MTIME` Register，其是一個單調遞增的固定頻率時間計數器，適用於所有連接到 MTIMER 的 HART
- `MTIMECMP` Register
  - 每個 HART 有一個對應的 `MTIMECMP` Register，作為對應的時間比較暫存器
  - 當 `MTIME` 的值達到或超過 `MTIMECMP` 的值時，觸發 Machine-level 的定時器中斷
- 如果 MTIMER 沒有連接到任何 HART
  - 它應該只包含 `MTIME` 暫存器
  - 不需要包含任何 `MTIMECMP` 暫存器，因為沒有 HART 需要時間比較功能

:::spoiler 原文
> On a RISC-V platform with multiple MTIMER devices:
> 
> * Each MTIMER device provides machine-level timer functionality for a different
> (or disjoint) set of HARTs.  
> 
>   A MTIMER device assigns a HART index starting from zero to each HART associated with it.  
> 
>   The HART index assigned to a HART by the MTIMER device may or may not have any relationship with the unique HART identifier (*hart ID*) that the RISC-V Privileged Architecture assigns to the HART.
> 
> * Two or more MTIMER devices can share the same physical MTIME register while having their own separate MTIMECMP registers.
> 
> * The MTIMECMP registers of a MTIMER device must only compare against the MTIME register of the same MTIMER device for generating machine-level timer interrupt.
> 
> The maximum number of HARTs supported by a single MTIMER device is 4095 which is equivalent to the maximum number of MTIMECMP registers.
:::

- 每個 MTIMER 設備只負責一組不同（或不相交）的 HART 的 machine-level 定時器功能
- HART Index
  - MTIMER 將從 0 開始分配 index 給所連接的 HART
  - index 與 RISC-V 特權架構分配的 HART ID 不一定有關
- `MTIME` 暫存器共享
  - 多個 MTIMER 設備可以共用一個物理上的 `MTIME` 暫存器
  - 但 MTIMER 設備仍擁有獨立的 `MTIMECMP` 暫存器，確保每個 HART 的比較和中斷處理是分開的
- `MTIMECMP` 的比較規則
  - `MTIMECMP` 暫存器只能與同一 MTIMER 設備的 `MTIME` 暫存器進行比較
  - 這種設計確保中斷由 MTIMER 設備內部獨立管理
- 每個 MTIMER 設備最多支持 4095 個 HART
  - 這與最多支持 4095 個 MTIMECMP 暫存器相對應

## Register Map

:::spoiler 原文
> A MTIMER device has two separate base addresses: one for the MTIME register and another for the MTIMECMP registers.
> 
> These separate base addresses of a single MTIMER device allows multiple MTIMER devices to share the same physical MTIME register.
:::

- MTIMER 設備有兩個 base addresses
  - `MTIME` Register Base Address：提供 Machine-level 的時間計數功能
  - `MTIMECMP` Registers Base Address：為每個 HART 提供獨立的時間比較功能
  - 用來使不同的 MTIMER 設備可以共享一個物理上的 `MTIME` 暫存器，但擁有獨立的 MTIMECMP 暫存器

ACLINT MTIMER Time Register Map：

| Offset      | Width | Attr | Name         | Description |
|-|-|-|-|-|
| 0x0000_0000 | 8B    | RW   | MTIME        | Machine-level time counter |

ACLINT MTIMER Compare Register Map：

| Offset      | Width | Attr | Name         | Description |
|-|-|-|-|-|
| 0x0000_0000 | 8B    | RW   | MTIMECMP0    | HART index 0 machine-level time compare |
| 0x0000_0008 | 8B    | RW   | MTIMECMP1    | HART index 1 machine-level time compare |
| ...         | ...   | ...  | ...          | ... |
| 0x0000_7FF0 | 8B    | RW   | MTIMECMP4094 | HART index 4094 machine-level time compare |

## MTIME Register (Offset: 0x00000000)

:::spoiler 原文
> The `MTIME` register is a 64-bit read-write register that contains the number of cycles counted based on a fixed reference frequency.
> 
> On MTIMER device reset, the MTIME register is cleared to zero.
:::

- `MTIME` 為 64-bit Read-Write 暫存器
- 用於存儲基於固定參考頻率（fixed reference frequency）的計數器值
- MTIMER reset 時，暫存器的值清為 0
- 提供單調遞增的時間基準，供 `MTIMECMP` 暫存器進行比較
- 用於觸發 Machine-level timer 中斷

## MTIMECMP Registers (Offsets: 0x00000000 - 0x00007FF0)

:::spoiler 原文
> The `MTIMECMP` registers are per-HART 64-bit read-write registers.  
> 
> It contains the `MTIME` register value at which machine-level timer interrupt is to be triggered for the corresponding HART.
:::

- 每個 HART 分配一個對應的 64-bit Read-Write `MTIMECMP` 暫存器
- 存儲一個 Target Value，當 `MTIME` 的值達到或超過此值時，對應的 HART 會觸發 Machine-level timer 中斷

:::spoiler 原文
> The machine-level timer interrupt of a HART is pending whenever `MTIME` is greater than or equal to the value in the corresponding `MTIMECMP` register.
> 
> The machine-level timer interrupt of a HART is cleared whenever `MTIME` is less than the value of the corresponding `MTIMECMP` register.
> 
> The machine-level timer interrupt is reflected in the MTIP bit of the `mip` CSR.
>
> On MTIMER device reset, the `MTIMECMP` registers are in unknown state.
:::

- 中斷觸發條件：
  - 當 `MTIME >= MTIMECMP` 時，對應 HART 的 Machine-level timer 中斷處於 pending 狀態
- 中斷清除條件：
  - 當 `MTIME < MTIMECMP` 時，對應 HART 的 Machine-level timer 中斷被清除
- 中斷狀態會反映在每個 HART 的 `mip` CSR 的 MTIP bit
- MTIMER 設備重置後，所有 `MTIMECMP` 暫存器處於未知狀態

## Synchronizing Multiple MTIME Registers

:::spoiler 原文
> A RISC-V platform can have multiple HARTs grouped into hierarchical topology groups (such as clusters, nodes, or sockets) where each topology group has its own MTIMER device.
>
> Further, such RISC-V platforms can also allow clock-gating or powering off for a topology group (including the MTIMER device) at runtime.
:::

- 在多 HART 的 RISC-V 平台上，HART 可以按照 clusters、nodes 或 sockets 劃分為拓撲組，每個拓撲組可以擁有獨立的 MTIMER 設備 
- 平台可以允許對整個拓撲組（包括 MTIMER 設備）進行 clock-gating 或關機的操作

:::spoiler 原文
> On a RISC-V platform with multiple MTIMER devices residing on the same die, each device must satisfy the RISC-V architectural requirement that all the `MTIME` registers with respect to each other, and all the per-HART time CSRs with respect to each other, are synchronized to within one `MTIME` tick period.
> 
> For example, if the `MTIME` tick period is 10ns, then the `MTIME` registers, and their associated `time` CSRs, should respectively be synchronized to within 10ns of each other.
:::

- 同一晶片內
  - 所有 `MTIME` Registers 和每個 HART 的 `time` CSRs 必須在一個 MTIME tick 週期內同步
  - 舉例來說，若 `MTIME` tick period 為 10ns，則同步偏差應限制在 10ns 內

:::spoiler 原文
> On a RISC-V platform with multiple MTIMER devices on different die, the `MTIME` registers (and their associated time CSRs) on different die may be synchronized to only within a specified interval of each other that is larger than the `MTIME` tick period. 
> 
> A platform may define a maximum allowed interval.
:::

- 不同晶片中
  - 各晶片的 `MTIME` Registers 和 `time` CSRs 可以允許更大的同步偏差
  - 平台可定義允許的最大同步間隔

:::spoiler 原文
> To satisfy the preceding `MTIME` synchronization requirements:
> 
> - All `MTIME` registers should have the same input clock so as to avoid runtime drift between separate `MTIME` registers (and their associated `time` CSRs)
> 
> - Upon system reset, the hardware must initialize and synchronize all `MTIME` registers to zero
> 
> - When a MTIMER device is stopped and started again due to, say, power management actions, the software should re-synchronize this `MTIME` register with all other `MTIME` registers
:::

- 所有 `MTIME` Registers 應使用相同的輸入時鐘，避免運行時的時鐘有誤差
- 系統重置時，硬體需初始化並同步所有 `MTIME` Registers 為零
- 當 MTIMER 因功耗管理等原因停止並重新啟動時，軟體需重新將該 `MTIME` Register 與其他 `MTIME` Registers 同步

:::spoiler 原文
> When software updates one, multiple, or all `MTIME` registers, it must maintain the preceding synchronization requirements (through measuring and then taking into account the differing latencies of performing reads or writes to the different MTIME registers).
:::

- 當軟體更新 `MTIME` Registers 時，需測量並補償不同暫存器的讀寫延遲以滿足前面的同步要求

:::spoiler 原文
> As an example, the below RISC-V 64-bit assembly sequence can be used by software to synchronize a `MTIME` register with reference to another `MTIME` register.
>
> **NOTE:** On some RISC-V platforms, the MTIME synchronization sequence (i.e. the aclint_mtime_sync() function above) will need to be repeated few times until delta between target MTIME register and reference MTIME register is zero (or very close to zero).
:::

以下為一範例 asm code，將目標 `MTIME` Register 與參考 `MTIME` Register 進行同步：

```cpp
/*
 * unsigned long aclint_mtime_sync(unsigned long target_mtime_address,
 *                                 unsigned long reference_mtime_address)
 */
        .globl aclint_mtime_sync
aclint_mtime_sync:
        /* Read target MTIME register in T0 register */
        ld        t0, (a0)
        fence     i, i

        /* Read reference MTIME register in T1 register */
        ld        t1, (a1)
        fence     i, i

        /* Read target MTIME register in T2 register */
        ld        t2, (a0)
        fence     i, i

        /*
         * Compute target MTIME adjustment in T3 register
         * T3 = T1 - ((T0 + T2) / 2)
         */
        srli      t0, t0, 1
        srli      t2, t2, 1
        add       t3, t0, t2
        sub       t3, t1, t3

        /* Update target MTIME register */
        ld        t4, (a0)
        add       t4, t4, t3
        sd        t4, (a0)

        /* Return MTIME adjustment value */
        add       a0, t3, zero

        ret
```

某些平台可能需要多次重複同步過程，直到目標與參考 `MTIME` Register 之間的偏差接近零

# Machine-level Software Interrupt Device (MSWI)

## Introduction

:::spoiler 原文
> The MSWI device provides machine-level IPI functionality for a set of HARTs on a RISC-V platform.
> 
> It has an IPI register (`MSIP`) for each HART connected to the MSWI device.
>
> On a RISC-V platform with multiple MSWI devices, each MSWI device provides machine-level IPI functionality for a different (or disjoint) set of HARTs. 
> 
> A MSWI device assigns a HART index starting from zero to each HART associated with it. 
> 
> The HART index assigned to a HART by the MSWI device may or may not have any relationship with the unique HART identifier (hart ID) that the RISC-V Privileged Architecture assigns to the HART.
>
> The maximum number of HARTs supported by a single MSWI device is 4095 which is equivalent to the maximum number of `MSIP` registers.
:::

- MSWI 設備為一組 HART 提供 Machine-level IPI 的功能
- 對於連接到 MSWI 設備的每個 HART，它都有一個對應的 IPI 暫存器（MSIP）
- 一個平台可以有多個 MSWI 設備，每個設備負責不同（或不相交）的一組 HART
- HART Index
  - 每個 MSWI 設備從 index 0 開始為其連接的 HART 分配一個 HART index
  - 該 index 用於標識 HART，但不一定與 RISC-V 特權架構分配的 HART ID 有關
- 每個 MSWI 設備最多支持 4095 個 HART，這與最多支持 4095 個 `MSIP` Registers 相對應

## Register Map

ACLINT MSWI Device Register Map：

| Offset      | Width | Attr | Name     | Description |
|-|-|-|-|-|
| 0x0000_0000 | 4B    | RW   | MSIP0    | HART index 0 machine-level IPI register |
| 0x0000_0004 | 4B    | RW   | MSIP1    | HART index 1 machine-level IPI register |
| ...         | ...   | ...  | ...      | ... |
| 0x0000_3FFC | 4B    |      | RESERVED | Reserved for future use. |

- addresse offset
  - 第 0 個 HART 的 MSIP 位於 0x0000_0000
  - 第 1 個 HART 的 MSIP 位於 0x0000_0004
  - 依此類推，每個暫存器占用 4 字節（32 位）
- 地址範圍 0x0000_3FFC 為保留區域，用於未來擴展

## MSIP Registers (Offsets: 0x00000000 - 0x00003FF8)

:::spoiler 原文
> Each MSIP register is a 32-bit wide WARL register where the upper 31 bits are wired to zero.
> 
> The least significant bit is reflected in MSIP of the `mip` CSR.
>
> A machine-level software interrupt for a HART is pending or cleared by writing `1` or `0` respectively to the corresponding MSIP register.
>
> On MSWI device reset, each MSIP register is cleared to zero.
:::

- 每個 `MSIP` 暫存器都是一個 32 位元寬的 WARL 暫存器
- 高 31 位硬接線為 0
- 最低有效位（LSB）反映 `mip` CSR 的 MSIP bit
- 寫入 `1` 可設置中斷掛起
- 寫入 `0` 可清除中斷
- MSWI 設備重設時，每個 `MSIP` 暫存器都清零

# Supervisor-level Software Interrupt Device (SSWI)

## Introduction

:::spoiler 原文
> The SSWI device provides supervisor-level IPI functionality for a set of HARTs on a RISC-V platform.
> 
> It provides a register to set an IPI (`SETSSIP`) for each HART connected to the SSWI device.
:::

- SSWI 設備為一組 HART 提供 Supervisor-level IPI 功能
- 對於連接到 SSWI 設備的每個 HART，它都有一個對應的 IPI 暫存器（`SETSSIP`）

:::spoiler 原文
> On a RISC-V platform with multiple SSWI devices, each SSWI device provides supervisor-level IPI functionality for a different (or disjoint) set of HARTs.
> 
> A SSWI device assigns a HART index starting from zero to each HART associated with it.
>
> The HART index assigned to a HART by the SSWI device may or may not have any relationship with the unique HART identifier (hart ID) that the RISC-V Privileged Architecture assigns to the HART.
>
> The maximum number of HARTs supported by a single SSWI device is 4095 which is equivalent to the maximum number of `SETSSIP` registers.
:::

- 在具有多個 SSWI 設備的 RISC-V 平台上，每個 SSWI 設備為不同（或不相交）的一組 HART 提供 Supervisor-level IPI 功能
- HART Index
  - 每個 SSWI 設備從 index 0 開始為其連接的 HART 分配一個 HART index
  - 該 index 用於標識 HART，但不一定與 RISC-V 特權架構分配的 HART ID 有關
- 每個 SSWI 設備最多支持 4095 個 HART，對應到 4095 個 `SETSSIP` Registers

## Register Map

ACLINT SSWI Device Register Map：

| Offset      | Width | Attr | Name     | Description |
|-|-|-|-|-|
| 0x0000_0000 | 4B    | RW   | SETSSIP0 | HART index 0 set supervisor-level IPI register |
| 0x0000_0004 | 4B    | RW   | SETSSIP1 | HART index 1 set supervisor-level IPI register |
| ...         | ...   | ...  | ...      | ... |
| 0x0000_3FFC | 4B    |      | RESERVED | Reserved for future use. |

- addresse offset
  - 第 0 個 HART 的 MSIP 位於 0x0000_0000
  - 第 1 個 HART 的 MSIP 位於 0x0000_0004
  - 依此類推，每個暫存器占用 4 字節（32 位）
- 地址範圍 0x0000_3FFC 為保留區域，用於未來擴展

## SETSSIP Registers (Offsets: 0x00000000 - 0x00003FF8)

:::spoiler 原文
> Each `SETSSIP` register is a 32-bit wide WARL register where the upper 31 bits are wired to zero. 
> 
> The least significant bit of a SETSSIP register always reads 0. Writing 0 to the least significant bit of a `SETSSIP` register has no effect whereas writing 1 to the least significant bit sends an edge-sensitive interrupt signal to the corresponding HART causing the HART to set SSIP in the `mip` CSR. 
> 
> Writes to a `SETSSIP` register are guaranteed to be reflected in SSIP of the corresponding HART but not necessarily immediately.
:::

- 每個 `SETSSIP` 暫存器都是一個 32 位元寬的 WARL 暫存器
- 高 31 位硬接線為 0
- 讀取 `SETSSIP` 暫存器的最低有效位元始終返回 `0`
- 將 `0` 寫入 `SETSSIP` 暫存器的最低有效位元不會產生任何影響
- 將 `1` 寫入最低有效位元會向對應的 HART 發送 edge-sensitive 中斷訊號，導致 HART 在 `mip` CSR 中設定 SSIP
- 對 `SETSSIP` 暫存器的寫入操作保證會反映在對應 HART 的 SSIP 中，但不一定會立即反映

:::spoiler 原文
> **NOTE**: The RISC-V Privileged Architecture defines SSIP in `mip` and `sip` CSRs as a <span class = "yellow">writeable</span> bit so the M-mode or S-mode software can directly clear SSIP.
:::

- RISC-V 特權架構中定義 SSIP `mip` 和 `sip` CSR 作為可寫位，因此 M mode 或 S mode 中軟體可以直接清除 SSIP
- 黃色部分不確定是拼錯還是有意為之