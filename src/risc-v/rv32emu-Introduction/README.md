---
title: rv32emu Introduction
date: 2024-12-15
mathjax: true
tag: risc-v
category: risc-v
---

# rv32emu Introduction

本篇撰寫於 12/12，rv32emu 以 Commit `451f8c0` 為主，semu 以 PR `#66` 為主，由於於 semu 上實作的特性之後會移植到 rv32emu 上，因此本文的範例 code 先以 semu 為例，少了 JIT 的部分較易理解

論文：[Accelerate RISC-V Instruction Set Simulation by Tiered JIT Compilation](https://dl.acm.org/doi/10.1145/3689490.3690399)

rv32emu 是針對 32 bit [RISC-V processor model](https://riscv.org/technical/specifications/) 開發的精簡高效模擬器，實作了 RISC-V ISA，支援 RV32I 與 M、A、F、C extension 以 C99 撰寫

## 模擬器的運作原理

模擬器是一種用軟體來模擬硬體的工具，其目的是在不同架構的電腦上運行特定架構的軟體，以我們的例子來說就是要在不同架構的電腦上運行 RISC-V 的軟體

下圖為 rv32emu 的架構圖：

<center>

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/risc-v/rv32emu-Introduction/image/1.png?raw=true">

</center><br>

為了模擬硬體，模擬器主要的邏輯為

1. 將要模擬的軟體載入到記憶體中 (load ELF)
2. 指令擷取 (Instruction Fetch)：從記憶體中讀取當前 PC 指向的指令
3. 指令解碼 (Instruction Decode)：解析指令中的欄位，例如 opcode、rd、rs1、rs2 和立即值 (immediate) 等
4. 指令執行：根據解碼的結果模擬對應的運算，更新暫存器或記憶體的內容，以及調整 PC 值

> 後面三點可以簡稱為 CPU emulation

依照 RISC-V 的[規格書](https://riscv.org/wp-content/uploads/2017/05/riscv-spec-v2.2.pdf)定義暫存器的數量與功能，並以不同指令集定義的操作和欄位來實作 CPU decoder 與指令集對應的操作(e.g. 加減乘除)，並將結果存在指定的暫存器，換句話說就是模擬 CPU 的[指令周期](https://en.wikipedia.org/wiki/Instruction_cycle)，這樣一來就能在不同的指令集架構的電腦上模擬 RISC-V 指令集的軟體

## 系統模擬的組成

為了達成上面的目的，至少需要實作以下三個單元：

- ELF loader （針對系統模擬，這項非必要）
- CPU emulator
- Memory I/O

這三個是一定要完成的部分，完成了這三個就可以模擬一些簡單的 bare metal program 了

但是如果要有更完整的模擬，像是 linux kernel 這樣複雜的軟體，那就需要根據需求多實作其他單元，像是

- MMU
  - 以 RISC-V 的 virtual-memory system 來說，`SXLEN=32` 時使用 SV32 model，`SXLEN=64` 時使用 SV39、SV48 或 SV57 model，詳見 priviledge spec 中的第 12 節
  - `satp` CSR 控制 S mode 下的位址轉換與保護，此暫存器會保存 root page table 的物理頁號（PPN）與 ASID
  - linux kernel 利用 virtual memory(VM) 的機制來實現記憶體管理的機制，但在 linux 中 VM 是透過 MMU 來實作的
  - 在缺乏 MMU 的環境下，如一些 microcontroller，使用的是 uClinux，其為「MicroController Linux」的縮寫，在此環境中會缺乏一些 systemcall，如 `fork` 與 `brk`/`sbrk`
    - 詳見 [No-MMU memory mapping support](https://www.kernel.org/doc/html/v6.9/admin-guide/mm/nommu-mmap.html) 與 [uClinux](https://wiki.csie.ncku.edu.tw/embedded/uclinux)
- peripherals (週邊)
  - PLIC
    - 用來管理外部中斷，提供多核處理器的中斷控制功能
  - CLINT/ACLINT
    - 用來支持內部中斷，如 software interrupt 與 timer interrupt
    - ACLINT 為 CLINT 的加強版，CLINT 不支援 supervisor-level 的 IPI
- VirtIO
  - Disk
  - network
  - GPU
- 基本的 SBI 支援
  - risc-v 架構上的 linux kernel 中透過 SBI 與底層溝通
  - 若要使用 SMP，則需要有 HSM extension 支援

### CPU emulator

要實現 CPU emulation 最基本的功能，我們只需要將會用到的暫存器，解碼的邏輯與指令執行的邏輯實作完成就好了，這邊以 semu 為例看一下簡單的 code，就可以理解到所謂的實作是怎麼一回事了

#### Register

在 riscv.h 中的 struct `__hart_internal` 定義了會用到的暫存器：

```c
struct __hart_internal {
    uint32_t x_regs[32];

    /* LR reservation virtual address. last bit is 1 if valid */
    uint32_t lr_reservation;

    /* Assumed to contain an aligned address at all times */
    uint32_t pc;

    /* Address of last instruction that began execution */
    uint32_t current_pc;

    // ...

    /* Supervisor state */
    bool s_mode;
    bool sstatus_spp; /**< state saved at trap */
    bool sstatus_spie;
    uint32_t sepc;
    uint32_t scause;
    uint32_t stval;
    bool sstatus_mxr; /**< alter MMU access rules */
    bool sstatus_sum;
    bool sstatus_sie; /**< interrupt state */
    uint32_t sie;
    uint32_t sip;
    uint32_t stvec_addr; /**< trap config */
    bool stvec_vectored;
    uint32_t sscratch; /**< misc */
    uint32_t scounteren;
    uint32_t satp; /**< MMU */
    uint32_t *page_table;

    // ...
};
```

由於模擬器目前是實作在 S mode 下的，所以這邊還有 S mode 下模擬器會用到的暫存器

#### Instruction Fetch

```c
#define PRIV(x) ((emu_state_t *) x->priv)
void vm_step(hart_t *vm)
{
    // ...

    uint32_t insn;
    mmu_fetch(vm, vm->pc, &insn);
    if (unlikely(vm->error))
        return;

    vm->pc += 4;
    /* Assume no integer overflow */
    vm->instret++;

    // ...
}
```

就是從 memory 中 PC 指向的位址提取出 `insn_opcode`

#### Decode

提取出 `insn_opcode` 後按照 Instruction Set 裡面給的表去做一一對應，你可以在 [RISCV ISA MANUAL](https://github.com/riscv/riscv-isa-manual/blob/main/src/rv-32-64g.adoc) 中看到這張表

以 ADDI 為例，其指令格式長這樣：

| imm[11:0] | rs1 | funct3 | rd | opcode | I-type |
|-|-|-|-|-|-|
| imm[11:0] | rs1 | 000 | rd | 0010011 | ADDI | 

因此在 riscv_private.h 中我們就可以看到 `RV32_OP_IMM` 的定義為 `0b0010011`：

```c
/* base RISC-V ISA */
enum {
    RV32_OP_IMM = 0b0010011,
    RV32_OP = 0b0110011,
    RV32_LUI = 0b0110111,
    RV32_AUIPC = 0b0010111,
    RV32_JAL = 0b1101111,
    RV32_JALR = 0b1100111,
    RV32_BRANCH = 0b1100011,
    RV32_LOAD = 0b0000011,
    RV32_STORE = 0b0100011,
    RV32_MISC_MEM = 0b0001111,
    RV32_SYSTEM = 0b1110011,
    RV32_AMO = 0b0101111,
};
```

而在 `vm_step` 中就會根據 opcode 的值選擇對應的格式：

```c
#define PRIV(x) ((emu_state_t *) x->priv)
void vm_step(hart_t *vm)
{
    // ...
    uint32_t insn_opcode = insn & MASK(7), value;
    switch (insn_opcode) {
    case RV32_OP_IMM:
        set_dest(vm, insn,
                 op_rv32i(insn, false, read_rs1(vm, insn), decode_i(insn)));
        break;
    case RV32_OP:
        if (!(insn & (1 << 25)))
            set_dest(
                vm, insn,
                op_rv32i(insn, true, read_rs1(vm, insn), read_rs2(vm, insn)));
        else
            set_dest(vm, insn,
                     op_mul(insn, read_rs1(vm, insn), read_rs2(vm, insn)));
        break;
    // ...
    case RV32_SYSTEM:
        op_system(vm, insn);
        break;
    default:
        vm_set_exception(vm, RV_EXC_ILLEGAL_INSN, 0);
        break;
    }
}
```

因為是以 ADDI 為例，所以這邊就會進到 `RV32_OP_IMM` 的部分，再其中會再以類似的方法將其餘的欄位，如 `rd`、`rs1`、`imm` 與 `func3`，給解析出來，得到確切的指令

#### Execute

在知道實際上要執行的是哪個指令後就可以直接於我們 host 端的平台上實作該指令的功能了，以 ADDI 來說其行為是將 `rs1` 加上 `imm` 的值寫入 `rd`，因此實作上直接利用 uint32_t 的加法就可以了：

```c
#define NEG_BIT (insn & (1 << 30))
static uint32_t op_rv32i(uint32_t insn, bool is_reg, uint32_t a, uint32_t b)
{
    /* TODO: Test ifunc7 zeros */
    switch (decode_func3(insn)) {
    case 0b000: /* IFUNC_ADD */
        return a + ((is_reg && NEG_BIT) ? -b : b);
    case 0b010: /* IFUNC_SLT */
        return ((int32_t) a) < ((int32_t) b);
    case 0b011: /* IFUNC_SLTU */
        return a < b;
    case 0b100: /* IFUNC_XOR */
        return a ^ b;
    case 0b110: /* IFUNC_OR */
        return a | b;
    case 0b111: /* IFUNC_AND */
        return a & b;
    case 0b001: /* IFUNC_SLL */
        return a << (b & MASK(5));
    case 0b101: /* IFUNC_SRL */
        return NEG_BIT ? (uint32_t) (((int32_t) a) >> (b & MASK(5))) /* SRA */
                       : a >> (b & MASK(5)) /* SRL */;
    }
    __builtin_unreachable();
}
#undef NEG_BIT
```

ADDI 的 func3 是 `000`，因此會計算 `a + ((is_reg && NEG_BIT) ? -b : b);` 並回傳，而在剛剛的 `vm_step` 中將其值作為參數傳入了 `set_dest`，其定義如下：

```c
static inline void set_dest(hart_t *vm, uint32_t insn, uint32_t x)
{
    uint8_t rd = decode_rd(insn);
    if (rd)
        vm->x_regs[rd] = x;
}
```

可以看見這邊將計算的值寫入到了 `rd`，如此一來就完成了 `ADDI` 的執行

### PLIC & ACLINT/CLINT

#### PLIC

對於 PLIC，詳見 [RISC-V PLIC](https://hackmd.io/@Mes/plic) 與 [spec](https://github.com/riscv/riscv-plic-spec/blob/master/riscv-plic.adoc)

RISC-V 內將 Trap 分為 Exception 與 Interrupt，而 Interrupt 有三種，分別為 software interrupt、timer interrupt 與 external interrupt。 而 PLIC 全名為 Platform Level Interrupt Controller，是一個 memory mapped device，如上述所說的用來處理 external interrupt，也就是下圖左邊的部分：

<center>

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/risc-v/rv32emu-Introduction/image/2.png?raw=true">

(img src: [Tuesday @ 0900 RISC V Interrupts Krste Asanović, UC Berkeley & SiFive Inc](https://www.youtube.com/watch?v=iPbaG_wnNJY))

</center>

PLIC 內主要分為 PLIC Gateway 與 PLIC Core，當中斷源（Interrupt Source）發起中斷時，其訊號會到達 Gateway，Gateway 再根據規定將這個中斷轉發給 PLIC Core，而 PLIC Core 再根據規定，利用 multicasting 的方式尋找可以處理這個中斷的 hart

下圖是更具體的流程：

<center>

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/risc-v/rv32emu-Introduction/image/3.png?raw=true">
 
(Figure 2. PLIC Interrupt Flow)

</center>

步驟如下：

- 全域中斷從其來源發送到中斷閘道，該閘道負責處理每個來源的中斷信號
- 中斷閘道隨後向 PLIC 核心發送單一的中斷請求，這些請求會在核心的中斷掛起位元（interrupt pending bits, IP）中鎖存（latches）
- 如果目標有啟用掛起的中斷，且掛起中斷的優先級超過每個目標的閾值，則 PLIC 核心會將中斷通知轉發給一個或多個目標
- 當目標接收到外部中斷後，它會向 PLIC 核心發送中斷請求，以檢索針對該目標的最高優先級全域中斷來源的識別碼
- PLIC 核心隨後清除相應的中斷來源掛起位元（interrupt source pending bit）
- 在目標處理完該中斷後，會向相關的中斷閘道發送中斷完成消息
- 之後中斷閘道便可以再為相同的來源向 PLIC 轉發另一個中斷請求了

#### ACLINT

對於 ACLINT，詳見 [RISC-V ACLINT](https://hackmd.io/@Mes/ACLINT) 與 [spec](https://github.com/riscv/riscv-aclint/blob/main/riscv-aclint.adoc)

ACLINT 是一「組」 memory mapped devices，用於在 multi-hart 的 RISC-V 平台上提供

- inter-processor interrupts (IPI)
- 定時器功能 (Timer functionalities)

內部分為有三個部分：

- MTIMER
  - Machine-level
  - 用以支持計時和產生 timer 中斷
  - 內含一個 `MTIME` 與多個 `MTIMECMP` 暫存器
- MSWI
  - Machine-level
  - 提供 Machine-level IPI 的功能
  - 內含一至多個 `MSIP` 暫存器，視連接的 HART 數量而定
- SSWI
  - Supervisor-level
  - 提供 Supervisor-level IPI 功能
  - 內含一至多個 `SETSSIP` 暫存器，視連接的 HART 數量而定

這三個為獨立的 interrupt controller，如果平台有替代機制，可以選擇性地省略部分 ACLINT 設備，可以看一下 QEMU 上的
device-tree config，你可以用以下命令生成 `SMP = 4` 情況下有 ACLINT 的 device-tree config：

```
qemu-system-riscv64 -machine virt,aclint=true -smp 4 -machine dumpdtb=qemu.dtb
dtc -I dtb -O dts -o qemu.dts qemu.dtb
```

你會看到內部有這三個 interrupt controller：

```dts
sswi@2f00000 {
  #interrupt-cells = <0x00>;
  interrupt-controller;
  interrupts-extended = <0x08 0x01 0x06 0x01 0x04 0x01 0x02 0x01>;
  reg = <0x00 0x2f00000 0x00 0x4000>;
  compatible = "riscv,aclint-sswi";
};

mtimer@2004000 {
  interrupts-extended = <0x08 0x07 0x06 0x07 0x04 0x07 0x02 0x07>;
  reg = <0x00 0x200bff8 0x00 0x4008 0x00 0x2004000 0x00 0x7ff8>;
  compatible = "riscv,aclint-mtimer";
};

mswi@2000000 {
  #interrupt-cells = <0x00>;
  interrupt-controller;
  interrupts-extended = <0x08 0x03 0x06 0x03 0x04 0x03 0x02 0x03>;
  reg = <0x00 0x2000000 0x00 0x4000>;
  compatible = "riscv,aclint-mswi";
};
```

##### timer interrupt

`MTIMER` 負責 timer interrupt，其內部有兩個暫存器，`MTIMECMP` 負責存儲著目標時間值，而 `MTIME` 會持續遞增。 當 `MTIME` 的值大於等於 `MTIMECMP` 時，就會觸發 timer interrupt，中斷狀態會反映在每個 HART 的 `mip` 暫存器的 MTIP bit

##### IPI

若要觸發 IPI，只須往對應的 `sip` 暫存器寫入 1 就好，以 M mode 來說就是 `MSIP`，S mode 來說就是 `SSIP`

#### ACLINT/CLINT 與 PLIC 的差異

##### 中斷種類

- PLIC 負責外部中斷，如 peripheral devices 與 I/O 設備的中斷
- ACLINT/CLINT 負責內部中斷，如 timer 與 IPI
  - CLINT 僅支援 machine-mode
  - ACLINT 多支援了 supervisor mode

##### 數量

- PLIC 是所有 hart 共用一個的
- ACLINT/CLINT 是每個 hart 都各自有一個的

##### register

- CLINT 將 IPI 和 timer 功能的暫存器放在一個統一的地址空間中
- ACLINT 將 IPI 和 timer 功能分別定義為獨立的 memory mapped device

### 多核系統模擬

#### SBI

SBI 是 RISC-V 定義的一個位於 OS 和 Firmware 之間的介面，用來提供 OS 需要的功能的介面，像是上面提到的 IPI 與 timer interrupt 的設定。 SBI 的實作被稱為 SEE，因此模擬器會需要提供 SEE（實作 SBI），才有辦法在上面運行 linux kernel

這樣的設計上底下的 SEE 可以抽換成不同的實作，上層的 OS 也可以正常的運作，也因此 rv32emu 實作在 S mode 下，在 linux 中可以定義不同的 interrupt controller，實作在 S mode 就可以避免每更新 interrupt controller 就需要修改 linux guest 的情況

<center>

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/risc-v/rv32emu-Introduction/image/4.png?raw=true">

</center><br>

#### SBI HSM Extension

HSM 全名為 Hart State Management，定義了其一系列的 hart 狀態，並提供 S mode 下的軟體一系列用來改變 hart 狀態的函式介面

在 [RISC-V Kernel Boot Requirements and Constraints](https://www.kernel.org/doc/html/next/riscv/boot.html#kernel-entry) 有提到在 SMP 系統上，有 2 種方法進入 linux kernel：

- `RISCV_BOOT_SPINWAIT`  
    主要用於支援沒有 SBI HSM extension 和 M mode RISC-V kernel 的 older firmwares

    此方法會啟動所有 hart，並隨機選一個 hart 來執行 early boot code，其他 hart 則等待初始化完成

- `Ordered booting`  
    僅會啟動一個 hart，執行 initialization phase，接著使用 SBI HSM extension 來啟動其他的所有 hart

在 Commit `cfafe26` ([link](https://github.com/torvalds/linux/commit/cfafe260137418d0265d0df3bb18dc494af2b43e)) 中引入了第二種方法：

> RISC-V: Add supported for ordered booting method using HSM<br><br>
>
> Currently, all harts have to jump Linux in RISC-V. This complicates the multi-stage boot process as every transient stage also has to ensure all harts enter to that stage and jump to Linux afterwards. It also obstructs a clean Kexec implementation.<br><br>
>
> SBI HSM extension provides alternate solutions where only a single hart need to boot and enter Linux. The booting hart can bring up secondary harts one by one afterwards.<br><br>
>
> Add SBI HSM based cpu_ops that implements an ordered booting method in RISC-V. This change is also backward compatible with older firmware not implementing HSM extension. If a latest kernel is used with older firmware, it will continue to use the default spinning booting method.

這裡提到以前每個 hart 在啟動的過程中都必須直接引導到 Linux，這讓 multi-stage 的啟動變得很麻煩，因為每個中間的階段都必須要管理所有的 hart，確保他們正確的轉換到 Linux 中

而 SBI HSM extension 簡化了啟動過程，只需要一個 hart 即可開機並進入 Linux，主 hart 進入 Linux 後，可以依序啟動其他 hart

以下是 [RISC-V SBI HSM Extension](https://github.com/riscv-non-isa/riscv-sbi-doc/blob/master/src/ext-hsm.adoc) 管理 hart 的方式，從下圖片中可以看到 hart 在 HSM 的管理下會有以下七種狀態，分別為：
- `STARTED`: hart 已物理上電並正常執行
- `STOPPED`: hart 不在 S mode 或更低特權模式下運行，如果底層平台具有物理斷電 hart 的機制，則它可以會被 SBI 實現斷電
- `SUSPENDED`: hart 處於低耗電狀態，如等待中斷或特定事件發生，發生時就會回到 `STARTED` 狀態
- `STOP_PENDING`、`START_PENDING`、`SUSPEND_PENDING`、`RESUME_PENDING`：代表正在進入下一個狀態，但由於 semu 是模擬器，因此這幾個狀態可以直接忽略，但在實際硬體運作上，作業系統會透過 sbi_hart_get_status 來取得 hart 的狀態，並根據取得的狀態做後續的動作

#### SBI IPI Extension

在 spec 裡面提到，當 hart 處於 `SUSPENDED` 的狀態，hart 會在收到中斷後切回 `STARTED` 模式，因此我們必須要有一個方式能夠讓 hart 之間能夠把對方叫起來，此時就要用到 [IPI Extension](https://github.com/riscv-non-isa/riscv-sbi-doc/blob/master/src/ext-ipi.adoc) 了

根據 IPI Extension 的定義，當有 hart 透過 IPI 這個 SBI 嘗試叫醒其他 hart 的話，就會對那個 hart 送出 supervisor software interrupt。 至於這個 supervisor software interrupt 要如何作到並沒有詳細定義，一般情況可以使用 [ACLINT](https://github.com/riscv/riscv-aclint) 或 CLINT 作到，在模擬器上也可以考慮不實作前述相關硬體，直接模擬軟體中斷即可

> ($\S$ 7.1 in [riscv-sbi-doc](https://github.com/riscv-non-isa/riscv-sbi-doc/tree/master)) Send an inter-processor interrupt to all the harts defined in hart_mask. Interprocessor interrupts manifest at the receiving harts as the supervisor software interrupts.

#### SBI TIMER Extension

Linux kernel 會不斷設定 timer 來設定下一次的 timer 中斷來達到現代作業系統所需的一些功能，像是排程。 而 [RISC-V SBI TIMER Extension](https://github.com/riscv-non-isa/riscv-sbi-doc/blob/master/src/ext-time.adoc) 定義了上述所需的界面。 Linux kernel 會透過讀取 hart 上的暫存器 time 後根據 time 的數值呼叫 `sbi_set_timer` 設定下一次的 timer interrupt：

```c
// https://elixir.bootlin.com/linux/v6.12.4/source/arch/riscv/kernel/sbi.c#L310

/**
 * sbi_set_timer() - Program the timer for next timer event.
 * @stime_value: The value after which next timer event should fire.
 *
 * Return: None.
 */
void sbi_set_timer(uint64_t stime_value)
{
	__sbi_set_timer(stime_value);
}
```

根據 TIMER Extension 的定義，我們所傳入的參數是一個 Absolute time，也就當 Timer 的時間超過所傳入的參數時，就會觸發 timer interrupt。而非呼叫 TIMER Extension 當下的 Timer 時間加上傳入的參數
> ($\S$ 5.1 in [riscv-sbi-doc](https://github.com/riscv-non-isa/riscv-sbi-doc/tree/master)) Programs the clock for next event after stime_value time. stime_value is in absolute time. This function must clear the pending timer interrupt bit as well.

#### 如何確認多核模擬器正確運作?

由於 linux 依賴於 HSM extension，因此我們可以在 Linux 中透過 `/proc/cpuinfo` 來驗證多核是否正確運作及 HSM 的實作是否正確，並可利用 `/proc/interrupts` 檢查 timer interrupt 的運作，還有透過查看 `/proc/device-tree` 來確認 ACLINT 是否有被正確識別：

```
## cat /proc/cpuinfo 
processor       : 0
hart            : 0
isa             : rv32ima
mmu             : sv32
mvendorid       : 0x12345678
marchid         : 0x80000001
mimpid          : 0x1

processor       : 1
hart            : 1
isa             : rv32ima
mmu             : sv32
mvendorid       : 0x12345678
marchid         : 0x80000001
mimpid          : 0x1

processor       : 2
hart            : 2
isa             : rv32ima
mmu             : sv32
mvendorid       : 0x12345678
marchid         : 0x80000001
mimpid          : 0x1

processor       : 3
hart            : 3
isa             : rv32ima
mmu             : sv32
mvendorid       : 0x12345678
marchid         : 0x80000001
mimpid          : 0x1

## cat /proc/interrupts 
           CPU0       CPU1       CPU2       CPU3       
  1:         81          0          0          0  SiFive PLIC   1 Edge      ttyS0
  2:          1          0          0          0  SiFive PLIC   3 Edge      virtio1
  3:          0          0          0          0  SiFive PLIC   2 Edge      virtio0
  5:       3738       3735       3734       3731  RISC-V INTC   5 Edge      riscv-timer
IPI0:        20         18         11          8  Rescheduling interrupts
IPI1:       178        634         40        609  Function call interrupts
IPI2:         0          0          0          0  CPU stop interrupts
IPI3:         0          0          0          0  CPU stop (for crash dump) interrupts
IPI4:         0          0          0          0  IRQ work interrupts
IPI5:         0          0          0          0  Timer broadcast interrupts
## ls /proc/device-tree/soc@F0000000/
#address-cells          mswi@4400000            sswi@4500000
#size-cells             mtimer@4300000          virtio@4100000
compatible              name                    virtio@4200000
interrupt-controller@0  ranges
interrupt-parent        serial@4000000
```

## Reference

- [Linux 核心專題: 多核 RISC-V 模擬和 Linux 驗證](https://hackmd.io/@sysprog/HyQ9UQ2E0)