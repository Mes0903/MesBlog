---
title: 實作一個回傳物理位址的系統呼叫
date: 2023-11-20
abstract: 這篇文章會教大家自己新增一個 system call，其作用是將傳入的 virtual address 轉換為 physical address 後回傳，因此文章中會簡單寫一下 linux 中的 page 與 page table，並帶大家簡單操作一次 page table
tags: Linux
categories:
- Linux
---

# 前言

這是 2023 NCU Linux Project 1 的 Demo，Demo 完後又花了一小段時間把報告補的更完整了一點

這篇文章會教大家自己新增一個 system call，其作用是將傳入的 virtual address 轉換為 physical address 後回傳

因此文章中會簡單寫一下 linux 中的 page 與 page table，並帶大家簡單操作一次 page table

測試的環境如下：

```
OS: Ubuntu 22.04
ARCH: X86_64
Source Version: 6.6
```

但因為是用 QEMU 跑，照理說應該不太會有環境的問題

# Build Linux Kernel

首先要先把 kernel Build 起來，這邊有錄一個 Demo 的影片：[Linux HW1 Demo](https://www.youtube.com/watch?v=6j7QreGqAmY)

> 下面的範例 code 跟影片中的 code 有些許不一樣，但操作起來的步驟是一樣的

先下載 kernel 的 source code：

```bash
# download the kernel code
wget https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.6.tar.xz
tar -xvf linux-6.6.tar.xz
cd linux-6.6
# Install required dependencies
sudo apt update && sudo apt install make gcc libncurses-dev flex bison
make allnoconfig
```

接著將 config 設定好

```bash
# Initialize kernel config
make menuconfig
64-bit kernel -> Enable
Executable file formats -> Enable all
Device Drivers > Character devices > Serial drivers and 8250/16550 and compatible serial support -> Enable
Device Drivers > Character devices > Console on 8250/16550 and compatible serial port -> Enable
General Setup > Initial RAM filesystem and RAM disk (initramfs/initrd) support -> Enable
Process type and features -> Linux guest support -> Support for running PVH guests -> Enable
```

下面是輸入 `make menuconfig` 後會出現的選單，把上面列出來的選項都勾起來：

![image.png](https://hackmd.io/_uploads/S13PsdmmT.png)
![image.png](https://hackmd.io/_uploads/r1sFiumQp.png)
![image.png](https://hackmd.io/_uploads/SkopsuQQT.png)
![image.png](https://hackmd.io/_uploads/SJz8IA4XT.png)


<!--
Cryptographic API -> Certificates for signature checking

```
File name or PKCS#11 URI of module signing key -> 改為空值
Additional X.509 keys for default system keyring -> 改為空值
Provide system-wide ring of blacklisted keys -> unselect
```

-->

然後開始編譯 kernel 

```bash
# Install required dependencies
sudo apt install libssl-dev libelf-dev
make -j <num_cpu>
```

# Build Root FS

由於 kernel 只寫好的 filesystem 的運作邏輯，例如要如何操作 ext4 的 filesystem，filesystem 本體是需要我們自己 mount 進去 kernel 的

這邊我們使用 busybox，它提供了一些常用的指令，像是 `cd` 和 `ls` 等等

首先下載 busybox 並編譯：
```bash
wget https://busybox.net/downloads/busybox-1.36.1.tar.bz2
tar -xf busybox-1.36.1.tar.bz2
cd busybox-1.36.1
make menuconfig # Select build static binary
make install
```

接著要製作等等要 mount 進 kernel 的 filesystem 本體，就是幾個簡單的資料夾
```bash
cd _install
mkdir -p lib lib64 proc sys etc etc/init.d
cat > ./etc/init.d/rcS << EOF
#!/bin/sh
# Mount the /proc and /sys filesystems
mount -t proc none /proc
mount -t sysfs none /sys
# Populate /dev
/sbin/mdev -s
EOF

chmod +x etc/init.d/rcS
find . | cpio -o --format=newc | gzip > ../../linux-6.6/rootfs.img.gz
```

![image.png](https://hackmd.io/_uploads/ryin_pmQa.png)


## Run Kernel

可以先簡單測一下 kernel 能不跑得起來

```bash
sudo apt install qemu qemu-kvm
qemu-system-x86_64 -kernel vmlinux -nographic -initrd rootfs.img.gz -append "root=/dev/ram rdinit=/sbin/init console=ttyS0"
```

沒問題的話我們就開始新增 system call 了

# Add System Call

## 修改 `syscall_64.tbl`

首先我們要新增自己的 system call，打開 `arch/x86/entry/syscalls/syscall_64.tbl`

在第 377 行後面新增我們自己的 system call：
```clike
454 common  my_get_physical_addresses   sys_my_get_physical_addresses   
```

![image](https://hackmd.io/_uploads/rkEPEJtNT.png)

這行有四個部分，每項之間由空白或 tab 隔開，它們代表的意義是：

+ `454`
    system call number，在使用系統呼叫時要使用這個數字
+ `common`
    支援的 ABI，    只能是 `64`、`x32` 或 `common`，分別表示「只支援 amd64」、「只支援 x32」或「都支援」
+ `my_get_physical_addresses`
    system call 的名字
+ `sys_my_get_physical_addresses`
    system call 對應的實作，kernel 中通常會用 `sys` 開頭來代表 system call 的實作

`syscall_64.tbl` 這個檔案會在 compile 階段被讀取後轉為 header file

檔案位於 `arch/x86/include/generated/asm/syscalls_64.h`：

![image](https://hackmd.io/_uploads/BJDhSyY4T.png)

## 實作自己的 system call

接下來要新增對應的 system call 實作，我們這裡要實作的是回傳 physical address 的 system call，所以先講一下要怎麼做到這件事

在 Linux 內部的記憶體地址映射過程為邏輯地址 –> 線性地址–> 實體地址 (PA)，實體地址最簡單：在匯流排中傳輸的數位信號，而線性地址和邏輯地址所表示的意涵則是種轉換規則，線性地址規則如下：

<center>
    
![image](https://hackmd.io/_uploads/S1x4HSM8p.png)
   
</center>

這部分由 MMU 完成，其中在 IA32 架構下，涉及到主要的暫存器有 CR0, CR3。機器指令中出現的是邏輯地址，邏輯地址規則如下：

<center>

![image](https://hackmd.io/_uploads/Hks4SrfUa.png)

</center>

在 Linux 中的邏輯地址對應於線性地址，也就是說 Intel 為了相容過往架構，把硬體設計搞得很複雜，Linux 核心的實作則予以簡化，並且在支援其他處理器架構時，儘量保持該原則。

### page in linux

page 在 v6.6.5 linux 中定義在 [mm_type.h](https://elixir.bootlin.com/linux/v6.6.5/source/include/linux/mm_types.h#L74) 的第 74 行：

::::: spoiler <span class = "yellow">`struct page` definition</span>
```cpp
struct page {
	unsigned long flags;		/* Atomic flags, some possibly
					 * updated asynchronously */
	/*
	 * Five words (20/40 bytes) are available in this union.
	 * WARNING: bit 0 of the first word is used for PageTail(). That
	 * means the other users of this union MUST NOT use the bit to
	 * avoid collision and false-positive PageTail().
	 */
	union {
		struct {	/* Page cache and anonymous pages */
			/**
			 * @lru: Pageout list, eg. active_list protected by
			 * lruvec->lru_lock.  Sometimes used as a generic list
			 * by the page owner.
			 */
			union {
				struct list_head lru;

				/* Or, for the Unevictable "LRU list" slot */
				struct {
					/* Always even, to negate PageTail */
					void *__filler;
					/* Count page's or folio's mlocks */
					unsigned int mlock_count;
				};

				/* Or, free page */
				struct list_head buddy_list;
				struct list_head pcp_list;
			};
			/* See page-flags.h for PAGE_MAPPING_FLAGS */
			struct address_space *mapping;
			union {
				pgoff_t index;		/* Our offset within mapping. */
				unsigned long share;	/* share count for fsdax */
			};
			/**
			 * @private: Mapping-private opaque data.
			 * Usually used for buffer_heads if PagePrivate.
			 * Used for swp_entry_t if PageSwapCache.
			 * Indicates order in the buddy system if PageBuddy.
			 */
			unsigned long private;
		};
		struct {	/* page_pool used by netstack */
			/**
			 * @pp_magic: magic value to avoid recycling non
			 * page_pool allocated pages.
			 */
			unsigned long pp_magic;
			struct page_pool *pp;
			unsigned long _pp_mapping_pad;
			unsigned long dma_addr;
			union {
				/**
				 * dma_addr_upper: might require a 64-bit
				 * value on 32-bit architectures.
				 */
				unsigned long dma_addr_upper;
				/**
				 * For frag page support, not supported in
				 * 32-bit architectures with 64-bit DMA.
				 */
				atomic_long_t pp_frag_count;
			};
		};
		struct {	/* Tail pages of compound page */
			unsigned long compound_head;	/* Bit zero is set */
		};
		struct {	/* ZONE_DEVICE pages */
			/** @pgmap: Points to the hosting device page map. */
			struct dev_pagemap *pgmap;
			void *zone_device_data;
			/*
			 * ZONE_DEVICE private pages are counted as being
			 * mapped so the next 3 words hold the mapping, index,
			 * and private fields from the source anonymous or
			 * page cache page while the page is migrated to device
			 * private memory.
			 * ZONE_DEVICE MEMORY_DEVICE_FS_DAX pages also
			 * use the mapping, index, and private fields when
			 * pmem backed DAX files are mapped.
			 */
		};

		/** @rcu_head: You can use this to free a page by RCU. */
		struct rcu_head rcu_head;
	};

	union {		/* This union is 4 bytes in size. */
		/*
		 * If the page can be mapped to userspace, encodes the number
		 * of times this page is referenced by a page table.
		 */
		atomic_t _mapcount;

		/*
		 * If the page is neither PageSlab nor mappable to userspace,
		 * the value stored here may help determine what this page
		 * is used for.  See page-flags.h for a list of page types
		 * which are currently stored here.
		 */
		unsigned int page_type;
	};

	/* Usage count. *DO NOT USE DIRECTLY*. See page_ref.h */
	atomic_t _refcount;

#ifdef CONFIG_MEMCG
	unsigned long memcg_data;
#endif

	/*
	 * On machines where all RAM is mapped into kernel address space,
	 * we can simply calculate the virtual address. On machines with
	 * highmem some memory is mapped into kernel virtual memory
	 * dynamically, so we need a place to store that address.
	 * Note that this field could be 16 bits on x86 ... ;)
	 *
	 * Architectures with slow multiplication can define
	 * WANT_PAGE_VIRTUAL in asm/page.h
	 */
#if defined(WANT_PAGE_VIRTUAL)
	void *virtual;			/* Kernel virtual address (NULL if
					   not kmapped, ie. highmem) */
#endif /* WANT_PAGE_VIRTUAL */

#ifdef CONFIG_KMSAN
	/*
	 * KMSAN metadata for this page:
	 *  - shadow page: every bit indicates whether the corresponding
	 *    bit of the original page is initialized (0) or not (1);
	 *  - origin page: every 4 bytes contain an id of the stack trace
	 *    where the uninitialized value was created.
	 */
	struct page *kmsan_shadow;
	struct page *kmsan_origin;
#endif

#ifdef LAST_CPUPID_NOT_IN_PAGE_FLAGS
	int _last_cpupid;
#endif
} _struct_page_alignment;
```
:::::

有關 `list_head` 的解說可以閱讀 [你所不知道的 C 語言: linked list 和非連續記憶體](https://hackmd.io/@sysprog/c-linked-list)。

struct page 本身就會佔有一定的記憶體空間，而在 [How many page flags do we really have?](https://lwn.net/Articles/335768/) 一文中有提到，於一個 4GB 的系統中將會有一百萬個 page 結構體實例，因此 struct page 內的每一個 byte 都需要做嚴格的把控

為了減少 struct page 本身使用的記憶體空間，設計上使用了 union，整個 struct page 使用了兩個大的 union 以節省記憶體空間

struct 的詳細內容可以看看這篇：[linux内核那些事之struct page](https://zhuanlan.zhihu.com/p/573338379)

或是查一下 struct page 應該就蠻多不錯的文章可以看了

### page table in linux

一般來說，x86 的架構使用 2-level 的 page table(10-10-12)，而 x86-64 的架構則使用 4-level(9-9-9-9-12) 或 5-level(`pgd_t` 和 `pud_t` 間多了一層 `p4d_t`) 的 page table，但也有 3-level 的，這可以透過 config 內的 `CONFIG_PGTABLE_LEVELS` 設定，基本上是 base on 處理器架構在設定的

以下是一個 4-level page table 的例子：

<center>

![image](https://hackmd.io/_uploads/SkzZ6kzIa.png)

圖源：[關於Linux記憶體尋址與頁表處理的一些細節](https://www.cnblogs.com/QiQi-Robotics/p/15630380.html)   
(圖很小，可以用新分頁打開來看一下)
    
</center>

每一個 Process 都會有自己的 Page Table，存在它自己的 kernel space，Page table 的 Base address 會被存在 CR3 裡面，這是一個 register，又被稱為 PDBR(page directory base register)，存的是實體位址，但 `task_struct->mm->pgd` 內儲存的則是 Process Global Directory 的虛擬位址

在 context switch 發生時，CR3 會載入新的 Process 的 Page Table，而將值寫入 CR3 時系統會自動刷新 TLB 的內容

因此要做虛擬位址與實體位址的轉換，只需要照著 Page Table 一層一層查下去就好，也就是 `pgd_t` -> `p4d_t` -> `pud_t` -> `pmd_t` -> `pte_t` 這樣查下去

查表的話可以使用對應的 function 來查，例如我要使用 `pgd_t` 查 `p4d_t`，那我可以這樣寫：

```c=
pgd_t *pgd;
p4d_t *p4d;

pgd = pgd_offset(current->mm, vaddr);
p4d = p4d_offset(pgd, vaddr);
```

要用 `p4d_t` 查 `pud_t` 同理：

```c=
pud_t *pud;
pud = pud_offset(p4d, vaddr);
```

我們可以看一下這些 offset function 的實作，以 v6.6.5 為例：

```c
// include/linux/pgtable.h line 91

#ifndef pte_offset_kernel
static inline pte_t *pte_offset_kernel(pmd_t *pmd, unsigned long address)
{
	return (pte_t *)pmd_page_vaddr(*pmd) + pte_index(address);
}
#define pte_offset_kernel pte_offset_kernel
#endif

// ...

// include/linux/pgtable.h line 119
/* Find an entry in the second-level page table.. */
#ifndef pmd_offset
static inline pmd_t *pmd_offset(pud_t *pud, unsigned long address)
{
	return pud_pgtable(*pud) + pmd_index(address);
}
#define pmd_offset pmd_offset
#endif

#ifndef pud_offset
static inline pud_t *pud_offset(p4d_t *p4d, unsigned long address)
{
	return p4d_pgtable(*p4d) + pud_index(address);
}
#define pud_offset pud_offset
#endif

static inline pgd_t *pgd_offset_pgd(pgd_t *pgd, unsigned long address)
{
	return (pgd + pgd_index(address));
};
```

基本上就和上面的圖一樣，找到對應的 Directory，加上對應的 index，如此一層層下去

`p4d` 比較特別，只有在特定的架構上有實作，如 `arch/x86/include/asm/pgtable.h`：

```c
/* to find an entry in a page-table-directory. */
static inline p4d_t *p4d_offset(pgd_t *pgd, unsigned long address)
{
	if (!pgtable_l5_enabled())
		return (p4d_t *)pgd;
	return (p4d_t *)pgd_page_vaddr(*pgd) + p4d_index(address);
}
```

一般的架構下參數傳進去會直接被 return：

```c
// include/asm-generic/pgtable-nop4d.h line 35

static inline p4d_t *p4d_offset(pgd_t *pgd, unsigned long address)
{
	return (p4d_t *)pgd;
}
```

也就是說 `pgd == p4d` 

而當在 3-level 的硬體架構上，則沒有 `pud` 與 `p4d`，因此參數傳進 `pud_offset` 也是會直接被 return：

```c
// include/asm-generic/pgtable-nopud.h line 42
static inline pud_t *pud_offset(p4d_t *p4d, unsigned long address)
{
	return (pud_t *)p4d;
}
#define pud_offset pud_offset
```

也就是 `pgd == p4d == pud`，其他的也是同理

### 開始實作 system call

打開 `include/linux/syscalls.h`

在第 942 行後新增
```c
asmlinkage long sys_my_get_physical_addresses(void *);
```

![image](https://hackmd.io/_uploads/HyMiUkFVT.png)


新增一個檔案叫 `project1.c`，路徑是 `kernel/project1.c`

:::::spoiler <span class = "yellow">範例 code</span>

```c
#include <linux/syscalls.h>
// #define DEBUG

SYSCALL_DEFINE1(my_get_physical_addresses, void *, addr_p)
{
	unsigned long vaddr = (unsigned long)addr_p;
	pgd_t *pgd;
	p4d_t *p4d;
	pud_t *pud;
	pmd_t *pmd;
	pte_t *pte;
	unsigned long paddr = 0;
	unsigned long page_addr = 0;
	unsigned long page_offset = 0;

	pgd = pgd_offset(current->mm, vaddr);
#ifdef DEBUG
	printk("pgd_val = 0x%lx\n", pgd_val(*pgd));
	printk("pgd_index = %lu\n", pgd_index(vaddr));
#endif
	if (pgd_none(*pgd)) {
		printk("not mapped in pgd\n");
		return 0;
	}

	p4d = p4d_offset(pgd, vaddr);
#ifdef DEBUG
	printk("p4d_val = 0x%lx\n", p4d_val(*p4d));
	printk("p4d_index = %lu\n", p4d_index(vaddr));
#endif
	if (p4d_none(*p4d)) {
		printk("not mapped in p4d\n");
		return 0;
	}

	pud = pud_offset(p4d, vaddr);
#ifdef DEBUG
	printk("pud_val = 0x%lx\n", pud_val(*pud));
	printk("pud_index = %lu\n", pud_index(vaddr));
#endif
	if (pud_none(*pud)) {
		printk("not mapped in pud\n");
		return 0;
	}

	pmd = pmd_offset(pud, vaddr);
#ifdef DEBUG
	printk("pmd_val = 0x%lx\n", pmd_val(*pmd));
	printk("pmd_index = %lu\n", pmd_index(vaddr));
#endif
	if (pmd_none(*pmd)) {
		printk("not mapped in pmd\n");
		return 0;
	}

	pte = pte_offset_kernel(pmd, vaddr);
#ifdef DEBUG
	printk("pte_val = 0x%lx\n", pte_val(*pte));
	printk("pte_index = %lu\n", pte_index(vaddr));
#endif
	if (pte_none(*pte)) {
		printk("not mapped in pte\n");
		return 0;
	}

	/* Page frame physical address mechanism | offset */
	page_addr = pte_val(*pte) & PAGE_MASK;
	page_offset = vaddr & ~PAGE_MASK;
	paddr = page_addr | page_offset;
#ifdef DEBUG
	printk("page_addr = %lx, page_offset = %lx\n", page_addr, page_offset);
	printk("vaddr = %lx, paddr = %lx\n", vaddr, paddr);
#endif

	return paddr;
}
```

:::::

> `virt_to_phys` 只能轉 kernel space 的 virtual address，因此必須從頭用 page table 查找

接下來要把這個檔案新增到 makefile 裡面，修改 `kernel/Makefile`

```
obj-y     = fork.o exec_domain.o panic.o \
	    cpu.o exit.o softirq.o resource.o \
	    sysctl.o capability.o ptrace.o user.o \
	    signal.o sys.o umh.o workqueue.o pid.o task_work.o \
	    extable.o params.o \
	    kthread.o sys_ni.o nsproxy.o \
	    notifier.o ksysfs.o cred.o reboot.o \
	    async.o range.o smpboot.o ucount.o regset.o ksyms_common.o \
	    project1.o
```

# Build Test Binary

接下來要寫一個 user program 來使用這個 system call，在 kernel 資料夾的外面新增一個檔案叫 `project1.c`

![image](https://hackmd.io/_uploads/S196vktET.png)

:::::spoiler <span class = "yellow">範例 code</span>

```c
#include <stdio.h>
#include <pthread.h>
#include <string.h>
#include <sys/syscall.h> /* Definition of SYS_* constants */
#include <unistd.h>
#include <stdlib.h>

extern void *func1(void *);
extern void *func2(void *);
extern int main();

void *my_get_physical_addresses(void *vaddr)
{
  return syscall(454, vaddr);
}

struct data_
{
  int id;
  char name[16];
};
typedef struct data_ sdata;
static __thread sdata tx; // thread local variable

int a = 123; // global variable
int *c;      // heap variable

void hello(int pid)
{
  int b = 10; // local variable

  b = b + pid;
  // global variable
  printf("[PID %d]: In thread %d, the value of global variable a is %d, the offset of the logical address of a is %p\n", pid, pid, a, &a);
  printf("[PID %d]: the physical address of global variable a is %p\n", pid, my_get_physical_addresses(&a));

  // local variable
  printf("[PID %d]: the value of local variable b is %d, the offset of the logical address of b is %p\n", pid, b, &b);
  printf("[PID %d]: the physical address of local variable b is %p\n", pid, my_get_physical_addresses(&b));

  // heap variable
  printf("[PID %d]: the value of heap variable c is %d, the offset of the logical address of c is %p\n", pid, *c, c);
  printf("[PID %d]: the physical address of heap variable c is %p\n", pid, my_get_physical_addresses(c));

  // thread local variable
  printf("[PID %d]: the offset of the logical address of thread local variable tx is %p\n", pid, &tx);
  printf("[PID %d]: the physical address of thread local variable tx is %p\n", pid, my_get_physical_addresses(&tx));

  // function
  printf("[PID %d]: the offset of the logical address of function hello is %p\n", pid, hello);
  printf("[PID %d]: the physical address of function hello is %p\n", pid, my_get_physical_addresses(hello));
  printf("[PID %d]: the offset of the logical address of function func1 is %p\n", pid, func1);
  printf("[PID %d]: the physical address of function func1 is %p\n", pid, my_get_physical_addresses(func1));
  printf("[PID %d]: the offset of the logical address of function func2 is %p\n", pid, func2);
  printf("[PID %d]: the physical address of function func2 is %p\n", pid, my_get_physical_addresses(func2));
  printf("[PID %d]: the offset of the logical address of function main is %p\n", pid, main);
  printf("[PID %d]: the physical address of function main is %p\n", pid, my_get_physical_addresses(main));
  
  // library function
  printf("[PID %d]: the offset of the logical address of library function printf is %p\n", pid, printf);
  printf("[PID %d]: the physical address of library function printf is %p\n", pid, my_get_physical_addresses(printf));
}

void *func1(void *arg)
{
  char *p = (char *)arg;
  int pid;
  pid = syscall(__NR_gettid);
  tx.id = pid;
  strcpy(tx.name, p);
  printf("[PID %d]: I am thread with ID %d executing func1().\n", pid, pid);
  hello(pid);
}

void *func2(void *arg)
{
  char *p = (char *)arg;
  int pid;
  pid = syscall(__NR_gettid);
  tx.id = pid;
  strcpy(tx.name, p);
  printf("[PID %d]: I am thread with ID %d executing func2().\n", pid, pid);
  hello(pid);
}

int main()
{
  pthread_t id[2];
  char p[2][16];
  c = (int *)malloc(sizeof(int));
  *c = 456;
  
  strcpy(p[0], "Thread1");
  pthread_create(&id[0], NULL, func1, (void *)p[0]);

  strcpy(p[1], "Thread2");
  pthread_create(&id[1], NULL, func2, (void *)p[1]);

  int pid;
  pid = syscall(__NR_gettid);
  tx.id = pid;
  strcpy(tx.name, "MAIN");
  printf("[PID %d]: I am main thread with ID %d.\n", pid, pid);
  hello(pid);

  pthread_join(id[0], NULL);
  pthread_join(id[1], NULL);
  free(c);
}
```

:::::

然後編譯它

```bash
gcc -static project1.c -o project1
```

然後將這個執行檔複製到 `busybox-1.36.1/_install` 內，並重新製作 image：

```bash
cd busybox-1.36.1/_install
cp ../../project1 .
find . | cpio -o --format=newc | gzip > ../../linux-6.6/rootfs.img.gz
```

# Run User Program

到 `linux-6.6` 下再執行一次 qemu：

```bash
cd linux-6.6
qemu-system-x86_64 -kernel vmlinux -nographic -initrd rootfs.img.gz -append "root=/dev/ram rdinit=/sbin/init console=ttyS0"
```

![image](https://hackmd.io/_uploads/rJfCO1KNa.png)

按 enter 可以開始下指令，可以先 `ls` 看看：

![image](https://hackmd.io/_uploads/B1GftyYV6.png)

這裡面就有我們編譯好的執行檔了，直接執行它：

![image](https://hackmd.io/_uploads/BJRQt1Y4a.png)


## 輸出：

:::::spoiler <span class = "yellow">輸出</span>

```bash
[PID 26]: I am thread with ID 26 executing func1().
[PID 26]: In thread 26, the value of global variable a is 123, the offset of the logical address of a is 0x4e0110
[PID 26]: the physical address of global variable a is 0x80000000017d9110
[PID 26]: the value of local variable b is 36, the offset of the logical address of b is 0x7fd051a94194
[PID 25]: I am main thread with ID 25.
[PID 27]: I am thread with ID 27 executing func2().
[PID 27]: In thread 27, the value of global variable a is 123, the offset of the logical address of a is 0x4e0110
[PID 27]: the physical address of global variable a is 0x80000000017d9110
[PID 27]: the value of local variable b is 37, the offset of the logical address of b is 0x7fd051293194
[PID 27]: the physical address of local variable b is 0x80000000017bd194
[PID 27]: the value of heap variable c is 456, the offset of the logical address of c is 0xffe770
[PID 27]: the physical address of heap variable c is 0x80000000017c0770
[PID 27]: the offset of the logical address of thread local variable tx is 0x7fd0512935e0
[PID 25]: In thread 25, the value of global variable a is 123, the offset of the logical address of a is 0x4e0110
[PID 25]: the physical address of global variable a is 0x80000000017d9110
[PID 25]: the value of local variable b is 35, the offset of the logical address of b is 0x7ffe9eda32f4
[PID 25]: the physical address of local variable b is 0x80000000017c12f4
[PID 25]: the value of heap variable c is 456, the offset of the logical address of c is 0xffe770
[PID 25]: the physical address of heap variable c is 0x80000000017c0770
[PID 25]: the offset of the logical address of thread local variable tx is 0xffd360
[PID 26]: the physical address of local variable b is 0x80000000017bf194
[PID 26]: the value of heap variable c is 456, the offset of the logical address of c is 0xffe770
[PID 26]: the physical address of heap variable c is 0x80000000017c0770
[PID 26]: the offset of the logical address of thread local variable tx is 0x7fd051a945e0
[PID 26]: the physical address of thread local variable tx is 0x80000000017bf5e0
[PID 26]: the offset of the logical address of function hello is 0x4017ed
[PID 26]: the physical address of function hello is 0x25eb7ed
[PID 26]: the offset of the logical address of function func1 is 0x401af7
[PID 26]: the physical address of function func1 is 0x25ebaf7
[PID 27]: the physical address of thread local variable tx is 0x80000000017bd5e0
[PID 27]: the offset of the logical address of function hello is 0x4017ed
[PID 27]: the physical address of function hello is 0x25eb7ed
[PID 27]: the offset of the logical address of function func1 is 0x401af7
[PID 27]: the physical address of function func1 is 0x25ebaf7
[PID 27]: the offset of the logical address of function func2 is 0x401b78
[PID 27]: the physical address of function func2 is 0x25ebb78
[PID 27]: the offset of the logical address of function main is 0x401bf9
[PID 27]: the physical address of function main is 0x25ebbf9
[PID 27]: the offset of the logical address of library function printf is 0x40bbb0
[PID 25]: the physical address of thread local variable tx is 0x80000000017cb360
[PID 25]: the offset of the logical address of function hello is 0x4017ed
[PID 25]: the physical address of function hello is 0x25eb7ed
[PID 25]: the offset of the logical address of function func1 is 0x401af7
[PID 25]: the physical address of function func1 is 0x25ebaf7
[PID 25]: the offset of the logical address of function func2 is 0x401b78
[PID 25]: the physical address of function func2 is 0x25ebb78
[PID 25]: the offset of the logical address of function main is 0x401bf9
[PID 25]: the physical address of function main is 0x25ebbf9
[PID 25]: the offset of the logical address of library function printf is 0x40bbb0
[PID 27]: the physical address of library function printf is 0x25f5bb0
[PID 26]: the offset of the logical address of function func2 is 0x401b78
[PID 26]: the physical address of function func2 is 0x25ebb78
[PID 26]: the offset of the logical address of function main is 0x401bf9
[PID 26]: the physical address of function main is 0x25ebbf9
[PID 26]: the offset of the logical address of library function printf is 0x40bbb0
[PID 26]: the physical address of library function printf is 0x25f5bb0
[PID 25]: the physical address of library function printf is 0x25f5bb0
```
:::::

::::: spoiler <span class = "yellow">將順序手動整理後的版本：</span>

```bash
[PID 26]: I am thread with ID 26 executing func1().
[PID 26]: In thread 26, the value of global variable a is 123, the offset of the logical address of a is 0x4e0110
[PID 26]: the physical address of global variable a is 0x80000000017d9110
[PID 26]: the value of local variable b is 36, the offset of the logical address of b is 0x7fd051a94194
[PID 26]: the physical address of local variable b is 0x80000000017bf194
[PID 26]: the value of heap variable c is 456, the offset of the logical address of c is 0xffe770
[PID 26]: the physical address of heap variable c is 0x80000000017c0770
[PID 26]: the offset of the logical address of thread local variable tx is 0x7fd051a945e0
[PID 26]: the physical address of thread local variable tx is 0x80000000017bf5e0
[PID 26]: the offset of the logical address of function hello is 0x4017ed
[PID 26]: the physical address of function hello is 0x25eb7ed
[PID 26]: the offset of the logical address of function func1 is 0x401af7
[PID 26]: the physical address of function func1 is 0x25ebaf7
[PID 26]: the offset of the logical address of function func2 is 0x401b78
[PID 26]: the physical address of function func2 is 0x25ebb78
[PID 26]: the offset of the logical address of function main is 0x401bf9
[PID 26]: the physical address of function main is 0x25ebbf9
[PID 26]: the offset of the logical address of library function printf is 0x40bbb0
[PID 26]: the physical address of library function printf is 0x25f5bb0
=====================================================================================================================
[PID 27]: I am thread with ID 27 executing func2().
[PID 27]: In thread 27, the value of global variable a is 123, the offset of the logical address of a is 0x4e0110
[PID 27]: the physical address of global variable a is 0x80000000017d9110
[PID 27]: the value of local variable b is 37, the offset of the logical address of b is 0x7fd051293194
[PID 27]: the physical address of local variable b is 0x80000000017bd194
[PID 27]: the value of heap variable c is 456, the offset of the logical address of c is 0xffe770
[PID 27]: the physical address of heap variable c is 0x80000000017c0770
[PID 27]: the offset of the logical address of thread local variable tx is 0x7fd0512935e0
[PID 27]: the physical address of thread local variable tx is 0x80000000017bd5e0
[PID 27]: the offset of the logical address of function hello is 0x4017ed
[PID 27]: the physical address of function hello is 0x25eb7ed
[PID 27]: the offset of the logical address of function func1 is 0x401af7
[PID 27]: the physical address of function func1 is 0x25ebaf7
[PID 27]: the offset of the logical address of function func2 is 0x401b78
[PID 27]: the physical address of function func2 is 0x25ebb78
[PID 27]: the offset of the logical address of function main is 0x401bf9
[PID 27]: the physical address of function main is 0x25ebbf9
[PID 27]: the offset of the logical address of library function printf is 0x40bbb0
[PID 27]: the physical address of library function printf is 0x25f5bb0
=====================================================================================================================
[PID 25]: I am main thread with ID 25.
[PID 25]: In thread 25, the value of global variable a is 123, the offset of the logical address of a is 0x4e0110
[PID 25]: the physical address of global variable a is 0x80000000017d9110
[PID 25]: the value of local variable b is 35, the offset of the logical address of b is 0x7ffe9eda32f4
[PID 25]: the physical address of local variable b is 0x80000000017c12f4
[PID 25]: the value of heap variable c is 456, the offset of the logical address of c is 0xffe770
[PID 25]: the physical address of heap variable c is 0x80000000017c0770
[PID 25]: the offset of the logical address of thread local variable tx is 0xffd360
[PID 25]: the physical address of thread local variable tx is 0x80000000017cb360
[PID 25]: the offset of the logical address of function hello is 0x4017ed
[PID 25]: the physical address of function hello is 0x25eb7ed
[PID 25]: the offset of the logical address of function func1 is 0x401af7
[PID 25]: the physical address of function func1 is 0x25ebaf7
[PID 25]: the offset of the logical address of function func2 is 0x401b78
[PID 25]: the physical address of function func2 is 0x25ebb78
[PID 25]: the offset of the logical address of function main is 0x401bf9
[PID 25]: the physical address of function main is 0x25ebbf9
[PID 25]: the offset of the logical address of library function printf is 0x40bbb0
[PID 25]: the physical address of library function printf is 0x25f5bb0
```

:::::

整理成表格

+ logical address：

	| identifier / logical address                 | main thread    | thread 1       | thread 2       | 位址一樣 |
	| -------------------------------------------- | -------------- | -------------- | -------------- | ---- |
	| global variable `a`                          | 0x4e0110       | 0x4e0110       | 0x4e0110       | ✅   |
	| local variable `b`                           | 0x7ffe9eda32f4 | 0x7fd051a94194 | 0x7fd051293194 | ❌   |
	| heap variable `c`                            | 0xffe770       | 0xffe770       | 0xffe770       | ✅   |
	| thread local variable `tx`                   | 0xffd360       | 0x7fd051a945e0 | 0x7fd0512935e0 | ❌   | 
	| logical address of function `hello`          | 0x4017ed       | 0x4017ed       | 0x4017ed       | ✅   |
	| logical address of function `func1`          | 0x401af7       | 0x401af7       | 0x401af7       | ✅   |
	| logical address of function `func2`          | 0x401b78       | 0x401b78       | 0x401b78       | ✅   |
	| logical address of function `main`           | 0x401bf9       | 0x401bf9       | 0x401bf9       | ✅   |
	| logical address of library function `printf` | 0x40bbb0       | 0x40bbb0       | 0x40bbb0       | ✅   |

+ physical address：

	| identifier / physical address                | main thread        | thread 1           | thread 2           | 位址一樣 |
	| -------------------------------------------- | ------------------ | ------------------ | ------------------ | ---- |
	| global variable `a`                          | 0x80000000017d9110 | 0x80000000017d9110 | 0x80000000017d9110 | ✅   |
	| local variable `b`                           | 0x80000000017c12f4 | 0x80000000017bf194 | 0x80000000017bd194 | ❌   | 
	| heap variable `c`                            | 0x80000000017c0770 | 0x80000000017c0770 | 0x80000000017c0770 | ✅   |
	| thread local variable `tx`                   | 0x80000000017cb360 | 0x80000000017bf5e0 | 0x80000000017bd5e0 | ❌   |
	| logical address of function `hello`          | 0x25eb7ed          | 0x25eb7ed          | 0x25eb7ed          | ✅   |
	| logical address of function `func1`          | 0x25ebaf7          | 0x25ebaf7          | 0x25ebaf7          | ✅   |
	| logical address of function `func2`          | 0x25ebb78          | 0x25ebb78          | 0x25ebb78          | ✅   |
	| logical address of function `main`           | 0x25ebbf9          | 0x25ebbf9          | 0x25ebbf9          | ✅   |
	| logical address of library function `printf` | 0x25f5bb0          | 0x25f5bb0          | 0x25f5bb0          | ✅   |

hackmd 的排版讓表格不太好看，所以這邊截一下圖：

![image](https://hackmd.io/_uploads/rkOUKEG8T.png)

把 memory layout 簡單畫出來：

![image](https://hackmd.io/_uploads/SyCr2-KET.png)

字很醜不好意思


# References

+ [Linux kernel on QEMU](https://blog.austint.in/2022/01/16/run-and-debug-linux-kernel-in-qemu-vm.html)
+ [Minimal kernel on QEMU](https://www.subrat.info/build-kernel-and-userspace/)
+ [embed linux bootstrap](https://gist.github.com/debuti/43e9104ae9eb59bdbb8b664c4fcf6839)
+ [initrd](https://docs.kernel.org/admin-guide/initrd.html)
+ [Page table](https://www.kernel.org/doc/gorman/html/understand/understand006.html)
+ [Get physical memory](https://zhuanlan.zhihu.com/p/642419727)
+ [ppodds Linux Kernel Project 1](https://hackmd.io/@ppodds/SkezlfZX6)
+ [linux内核那些事之struct page](https://zhuanlan.zhihu.com/p/573338379)
+ [How to Add a System Call](https://member.adl.tw/ernieshu/syscall_3_14_4.html)
+ [How many page table levels does Linux kernel use? 4 or 5?](https://unix.stackexchange.com/questions/379230/how-many-page-table-levels-does-linux-kernel-use-4-or-5)
+ [關於Linux記憶體尋址與頁表處理的一些細節](https://www.cnblogs.com/QiQi-Robotics/p/15630380.html)
+ [學習ARM64頁表轉換流程](https://cloud.tencent.com/developer/article/1622986?fbclid=IwAR3aLMPWaomBgeDYcXU60-Xz0wgMRPLdB9iNndphbnCDnxqC0EXAC6iNsG4)
+ [自由工作者-萊昂筆記-頁表](https://github.com/freelancer-leon/notes/blob/master/kernel/mm/mm_pagetable.md?fbclid=IwAR27yWHgWVyVzPwXdSjdxCaEFYiKTZW2cAMxgCDjVXIBM8e7MvAjdPmZUps)
+ [分頁架構](https://www.csie.ntu.edu.tw/~wcchen/asm98/asm/proj/b85506061/chap2/paging.html?fbclid=IwAR0PUt5zCou3Lyrw93VdI7w2sgM25rN0gACqivFwlBTGHUwdSFAq0w0hhvI)
+ [Linux 核心設計: 記憶體管理](https://hackmd.io/@sysprog/linux-memory)