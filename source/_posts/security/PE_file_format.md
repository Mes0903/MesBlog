---
title: PE file format
date: 2023/1/9
abstract: PE 是 Portable Executable 的縮寫，它是根據 UNIX 系統的 COFF 來設計的，在 Windows 下所有的可執行文件都是 PE File，像是 EXE、DLL、SYS、OCX 等等，因為專題無聊就跑來玩這個了
tags: security
categories:
- security
---

# PE file format

# 前言

PE 是 Portable Executable 的縮寫，它是根據 UNIX 系統的 COFF 來設計的，在 Windows 下所有的可執行文件都是 PE File，像是 EXE、DLL、SYS、OCX 等等。

PE File 內部的格式是規定好的，也就是所謂的 PE file format，大致可以分為兩部分，Header 與 Section：

![](https://i.imgur.com/BfrIbY7.png)
(圖片[連結](https://www.researchgate.net/figure/Portable-executable-file-format_fig6_338355873))

Header 是用來管理 PE file 的，包含了一些執行檔的重要資訊，而 Section 則包含了程式碼、常量、資料和圖片資源等等。

為了後續講解，這邊用 asm 寫了一個很簡單的 Windows Program，執行檔名為 demo.exe：
```asm
; demo.asm

    .386
    .model flat, stdcall
    option casemap:none

include \masm32\include\windows.inc
include \masm32\include\kernel32.inc
include \masm32\include\user32.inc
include \masm32\include\masm32.inc
includelib \masm32\lib\kernel32.lib
includelib \masm32\lib\user32.lib
includelib \masm32\lib\masm32.lib

    .data
szCaptions  db 'hello', 0
szText  db 'Hello World!', 0

    .code
start:
    push 0
    lea eax, szCaptions
    push eax
    lea eax, szText
    push eax
    push 0
    call MessageBox
    push 0
    call ExitProcess

    end start
```

由於我是用 masm 組譯，所以指令就下
```bash
\masm32\bin\ml /c /Zd /coff demo.asm
\masm32\bin\Link /SUBSYSTEM:CONSOLE demo.obj
```

我們可以用 PE-bear 這個軟體來看 PE file 的內容，這是我用 PEbear 將 demo.exe 開起來的樣貌：

![](https://i.imgur.com/DSXIYGw.png)

可以看見 demo.exe 由 DOS Header, DOS stub, NT Headers, Section Headers 與幾個 Sections 組成，那接下來就會依序介紹這些東西。

# DOS Header

PE file 最一開始的部分是 Dos Header，PE-bear 可以幫我們把這段 binary：

![](https://i.imgur.com/pSgDDr2.png)

解析為這樣：

![](https://i.imgur.com/f2ipUd5.png)

DOS Header 是 PE File 中的起始位置，以前的功用是用來保持與 DOS 的兼容性與定位 NT Header，而現在的功用只剩下後者。

DOS Header 是一個 C struct，在 `winnt.h` 中的定義如下：
```c
typedef struct _IMAGE_DOS_HEADER {      // DOS .EXE header
  WORD   e_magic;                     // EXE 簽名 mz
  WORD   e_cblp;                      // Bytes on last page of file
  WORD   e_cp;                        // Pages in file
  WORD   e_crlc;                      // Relocations
  WORD   e_cparhdr;                   // Size of header in paragraphs
  WORD   e_minalloc;                  // Minimum extra paragraphs needed
  WORD   e_maxalloc;                  // Maximum extra paragraphs needed
  WORD   e_ss;                        // Initial (relative) SS value
  WORD   e_sp;                        // Initial SP value
  WORD   e_csum;                      // Checksum
  WORD   e_ip;                        // Initial IP value
  WORD   e_cs;                        // Initial (relative) CS value
  WORD   e_lfarlc;                    // File address of relocation table
  WORD   e_ovno;                      // Overlay number
  WORD   e_res[4];                    // Reserved words
  WORD   e_oemid;                     // OEM identifier (for e_oeminfo)
  WORD   e_oeminfo;                   // OEM information; e_oemid specific
  WORD   e_res2[10];                  // Reserved words
  LONG   e_lfanew;                    // NT Header 位址
} IMAGE_DOS_HEADER, *PIMAGE_DOS_HEADER;
```

它的大小為 `40h`(h 代表用十六進位表示)，其中 `WORD` 是 2bytes，`LONG` 是 4bytes。 我們關心的只有兩個成員：`e_magic` 與 `e_lfanew`。

`e_magic` 是一個簽名，ASCII 的轉換結果為 `MZ`，所有的 PE file 都要以這個 `MZ` 開頭；而 `e_lfanew` 指向 NT Header 的位址。 其它的元素是在 DOS 環境下要使用的，在 Windows 下就無關。

而 DOS Stub 也是在 DOS 環境下使用的，主要功能就是拿來報錯，這邊也就不詳細介紹。

# NT Headers (PE Headers)

NT Headers 也是一個 C struct，它在 `winnt.h` 的定義如下：
```cpp
#ifdef _WIN64
typedef IMAGE_NT_HEADERS64                  IMAGE_NT_HEADERS;
typedef PIMAGE_NT_HEADERS64                 PIMAGE_NT_HEADERS;
#else
typedef IMAGE_NT_HEADERS32                  IMAGE_NT_HEADERS;
typedef PIMAGE_NT_HEADERS32                 PIMAGE_NT_HEADERS;
#endif
```

其中的 `32` 與 `64` 就代表 32 位元和 64 位元，在編譯期的時候就會選擇好了。

而 `IMAGE_NT_HEADERS64` 與 `IMAGE_NT_HEADERS32` 的差異也很小：

```cpp
typedef struct _IMAGE_NT_HEADERS64 {
    DWORD Signature; // PE 簽名
    IMAGE_FILE_HEADER FileHeader;
    IMAGE_OPTIONAL_HEADER64 OptionalHeader;
} IMAGE_NT_HEADERS64, *PIMAGE_NT_HEADERS64;

typedef struct _IMAGE_NT_HEADERS {
    DWORD Signature;
    IMAGE_FILE_HEADER FileHeader;
    IMAGE_OPTIONAL_HEADER32 OptionalHeader;
} IMAGE_NT_HEADERS32, *PIMAGE_NT_HEADERS32;
```

可以看見基本上一樣的，差異只在 Optional Header。

第一個成員 `Signature` 是 `PE File` 的簽名，簽名為 `PE`，用 PE-bear 可以看見其 binary 為 
`00 00 45 50`(此 exe 為 little endian)。

![](https://i.imgur.com/s36aBT9.png)

## FileHeader

FileHeader 的定義如下：

```cpp
typedef struct _IMAGE_FILE_HEADER {
  WORD    Machine;                       // 平台，intel 386 為 0x014c，intel 64 為 0x0200
  WORD    NumberOfSections;              // Section 數量，最多 96 個字節
  DWORD   TimeDateStamp;                 // 編譯日期
  DWORD   PointerToSymbolTable;
  DWORD   NumberOfSymbols;
  WORD    SizeOfOptionalHeader;          // OptionalHeader 大小, 32 位通常為 E0，64 位通常為 F0
  WORD    Characteristics;               // 檔案屬性，EXE 通常為 010f，DLL 通常為 210e
} IMAGE_FILE_HEADER, *PIMAGE_FILE_HEADER;
```

`Machine` 表示平台，可能得值如下：
```cpp
#define IMAGE_FILE_MACHINE_UNKNOWN           0
#define IMAGE_FILE_MACHINE_TARGET_HOST       0x0001  // Useful for indicating we want to interact with the host and not a WoW guest.
#define IMAGE_FILE_MACHINE_I386              0x014c  // Intel 386.
#define IMAGE_FILE_MACHINE_R3000             0x0162  // MIPS little-endian, 0x160 big-endian
#define IMAGE_FILE_MACHINE_R4000             0x0166  // MIPS little-endian
#define IMAGE_FILE_MACHINE_R10000            0x0168  // MIPS little-endian
#define IMAGE_FILE_MACHINE_WCEMIPSV2         0x0169  // MIPS little-endian WCE v2
#define IMAGE_FILE_MACHINE_ALPHA             0x0184  // Alpha_AXP
#define IMAGE_FILE_MACHINE_SH3               0x01a2  // SH3 little-endian
#define IMAGE_FILE_MACHINE_SH3DSP            0x01a3
#define IMAGE_FILE_MACHINE_SH3E              0x01a4  // SH3E little-endian
#define IMAGE_FILE_MACHINE_SH4               0x01a6  // SH4 little-endian
#define IMAGE_FILE_MACHINE_SH5               0x01a8  // SH5
#define IMAGE_FILE_MACHINE_ARM               0x01c0  // ARM Little-Endian
#define IMAGE_FILE_MACHINE_THUMB             0x01c2  // ARM Thumb/Thumb-2 Little-Endian
#define IMAGE_FILE_MACHINE_ARMNT             0x01c4  // ARM Thumb-2 Little-Endian
#define IMAGE_FILE_MACHINE_AM33              0x01d3
#define IMAGE_FILE_MACHINE_POWERPC           0x01F0  // IBM PowerPC Little-Endian
#define IMAGE_FILE_MACHINE_POWERPCFP         0x01f1
#define IMAGE_FILE_MACHINE_IA64              0x0200  // Intel 64
#define IMAGE_FILE_MACHINE_MIPS16            0x0266  // MIPS
#define IMAGE_FILE_MACHINE_ALPHA64           0x0284  // ALPHA64
#define IMAGE_FILE_MACHINE_MIPSFPU           0x0366  // MIPS
#define IMAGE_FILE_MACHINE_MIPSFPU16         0x0466  // MIPS
#define IMAGE_FILE_MACHINE_AXP64             IMAGE_FILE_MACHINE_ALPHA64
#define IMAGE_FILE_MACHINE_TRICORE           0x0520  // Infineon
#define IMAGE_FILE_MACHINE_CEF               0x0CEF
#define IMAGE_FILE_MACHINE_EBC               0x0EBC  // EFI Byte Code
#define IMAGE_FILE_MACHINE_AMD64             0x8664  // AMD64 (K8)
#define IMAGE_FILE_MACHINE_M32R              0x9041  // M32R little-endian
#define IMAGE_FILE_MACHINE_ARM64             0xAA64  // ARM64 Little-Endian
#define IMAGE_FILE_MACHINE_CEE               0xC0EE
```

以 demo.exe 來說，其值為 `014c`

![](https://i.imgur.com/AGvgrV0.png)

這很長一串，用到的時候再查就好。

`TimeDateStamp` 表示編譯日期；`SizeOfOptionalHeader` 表示 Optional Header 的大小，32 bit 的電腦通常為 `0xE0`，64 bit 通常為 `0xF0`。

Characteristics 記錄了這個檔案的屬性，會是以下這些值去做 `or` 運算：
```cpp
#define IMAGE_FILE_RELOCS_STRIPPED           0x0001  // Relocation info stripped from file.
#define IMAGE_FILE_EXECUTABLE_IMAGE          0x0002  // File is executable  (i.e. no unresolved external references).
#define IMAGE_FILE_LINE_NUMS_STRIPPED        0x0004  // Line nunbers stripped from file.
#define IMAGE_FILE_LOCAL_SYMS_STRIPPED       0x0008  // Local symbols stripped from file.
#define IMAGE_FILE_AGGRESIVE_WS_TRIM         0x0010  // Aggressively trim working set
#define IMAGE_FILE_LARGE_ADDRESS_AWARE       0x0020  // App can handle >2gb addresses
#define IMAGE_FILE_BYTES_REVERSED_LO         0x0080  // Bytes of machine word are reversed.
#define IMAGE_FILE_32BIT_MACHINE             0x0100  // 32 bit word machine.
#define IMAGE_FILE_DEBUG_STRIPPED            0x0200  // Debugging info stripped from file in .DBG file
#define IMAGE_FILE_REMOVABLE_RUN_FROM_SWAP   0x0400  // If Image is on removable media, copy and run from the swap file.
#define IMAGE_FILE_NET_RUN_FROM_SWAP         0x0800  // If Image is on Net, copy and run from the swap file.
#define IMAGE_FILE_SYSTEM                    0x1000  // System File.
#define IMAGE_FILE_DLL                       0x2000  // File is a DLL.
#define IMAGE_FILE_UP_SYSTEM_ONLY            0x4000  // File should only be run on a UP machine
#define IMAGE_FILE_BYTES_REVERSED_HI         0x8000  // Bytes of machine word are reversed.
```

以 demo.exe 來說其值為 `0x010f`，因此是 1, 2, 4, 8, 100 做 `or` 運算

![](https://i.imgur.com/rp3SlJU.png)

## Optional Header (可選頭)
Optional Header 雖然有 `Optional` 這詞在裡面，但它是一定要有的，其定義如下：

```cpp
typedef struct _IMAGE_OPTIONAL_HEADER {
    //
    // Standard fields.
    //

    WORD    Magic;                       // 簽名， 107h = ROM Image， 10Bh = EXE Image，20Bh = PE32+
    BYTE    MajorLinkerVersion;          // Linker 版本號
    BYTE    MinorLinkerVersion;
    DWORD   SizeOfCode;                  // 所有含有程式碼的 Section 大小
    DWORD   SizeOfInitializedData;       // 所有含有初始化數據的 Section 大小
    DWORD   SizeOfUninitializedData;     // 所有含位未始化數據的 Section 大小(不佔用檔案空間，載入記憶體後才會分配空間)
    DWORD   AddressOfEntryPoint;         // Process 執行入口 RVA(距離 PE 載入後地址的距離，病毒和加密程式都會修改其值，從而獲得程式的控制權；對於 DLL，如果沒有入口函式，那麼就是 0；對於驅動其值為初始化的函式地址)
    DWORD   BaseOfCode;                  // 程式碼的 Section 的起始 RVA(通常跟在 NT Header 後)
    DWORD   BaseOfData;                  // 數據的 Section 的起始 RVA 

    //
    // NT additional fields.
    //

    DWORD   ImageBase;                   // Process 建議的載入地址
    DWORD   SectionAlignment;            // 記憶體中的 Section 對齊值
    DWORD   FileAlignment;               // 檔案中的 Section 對齊值
    WORD    MajorOperatingSystemVersion; // OS 版本號
    WORD    MinorOperatingSystemVersion;
    WORD    MajorImageVersion;           // PE 版本號
    WORD    MinorImageVersion;
    WORD    MajorSubsystemVersion;       // 需要的 Subsystem 版本號
    WORD    MinorSubsystemVersion;
    DWORD   Win32VersionValue;           // 未使用，必須為 0
    DWORD   SizeOfImage;                 // 記憶體中整個 PE 檔案的 image 大小
    DWORD   SizeOfHeaders;               // 所有的 Header 與 Section Header 加起來的大小
    DWORD   CheckSum;                    // 檢驗值，一般文件為 0，DLL 和 SYS 則會有其設定的值
    WORD    Subsystem;                   // 檔案子系統
    WORD    DllCharacteristics;          // DLL 檔案特性
    DWORD   SizeOfStackReserve;          // 初始化時保留的 stack 大小 (預設 1M)
    DWORD   SizeOfStackCommit;           // 初始化時實際給予的 stack 大小 (預設 4K)
    DWORD   SizeOfHeapReserve;           // 初始化時保留的 Heap 大小 (預設 1M)
    DWORD   SizeOfHeapCommit;            // 初始化時實際給予的 Heap 大小 (預設 4K)
    DWORD   LoaderFlags;                 // 加載旗幟，通常是 0
    DWORD   NumberOfRvaAndSizes;         // 數據目錄的數量
    IMAGE_DATA_DIRECTORY DataDirectory[IMAGE_NUMBEROF_DIRECTORY_ENTRIES]; // 數據目錄的陣列
} IMAGE_OPTIONAL_HEADER32, *PIMAGE_OPTIONAL_HEADER32;
```

# Section Headers (區段頭)

Section Header 會記錄每個 Section 的資訊，定義如下：

```cpp
#define IMAGE_SIZEOF_SHORT_NAME              8

typedef struct _IMAGE_SECTION_HEADER {
    BYTE    Name[IMAGE_SIZEOF_SHORT_NAME];       // 區段名，如 .text 或 .data
    union {
            DWORD   PhysicalAddress;
            DWORD   VirtualSize;                 // 區段大小
    } Misc;
    DWORD   VirtualAddress;                      // 區段的位移 (RVA)
    DWORD   SizeOfRawData;                       // Section 在檔案中對齊後的大小
    DWORD   PointerToRawData;                    // Section 在檔案中的偏移量 (FOA)
    DWORD   PointerToRelocations;                // 在 OBJ 文件中使用
    DWORD   PointerToLinenumbers;                // 行號表的位置(debug 時使用)
    WORD    NumberOfRelocations;                 // 在 OBJ 文件中使用
    WORD    NumberOfLinenumbers;                 // 行號表中行號的數量
    DWORD   Characteristics;                     // Section 屬性
} IMAGE_SECTION_HEADER, *PIMAGE_SECTION_HEADER;

#define IMAGE_SIZEOF_SECTION_HEADER          40
```

每個 Section Header 會指向對應的 Section，像是這樣

![](https://i.imgur.com/OO7V54g.png)
(圖片[連結](https://tech-zealots.com/malware-analysis/pe-portable-executable-structure-malware-analysis-part-2/))

Section Header 只負責記錄對應 Section 的重要屬性，像是 Section 的名字，大小，RVA 等等。

# Section(區段)

在 Headers 之後接的就是各個 Section，像是大家熟悉的 `.text`、`.data` 等等都是個 Section。

`.text` 通常會是第一個 Section，是你可執行程式碼所在的位置，執行檔的進入點通常也會在這裡。

`.data` 段則是放你的數據，像是我們 `std::cout << "Hello";`，那麼 `"Hello"` 這個資料就會放在 `.data` 裡面。

其他還有很多，上面的圖也可以大概看到，有興趣的可以查一下，這邊就不贅述。

# VA、RVA、FOA

而一個 PE 在硬碟與在記憶體中的偏移量會有所不同，這邊會有三個名詞先介紹一下：

+ VA: 虛擬位址(Virtual Address)，指 PE 檔案載入「記憶體」後的位址
+ RVA: 相對虛擬位址(Relative Virtual Address)，是 PE 檔案中資料、Section 等在「記憶體」中的偏移量
+ FOA: 文件偏移位址(File Offset Address)，是 PE 檔案中資料、Section 等在「硬碟」中的偏移量

我們看張圖來解釋：

![](https://i.imgur.com/IYN5DN3.png)

這邊假設每個 Section 的大小都小於 Alignment 的大小，所以一個 Section 的大小就是一個 Alignment 的大小。x86 下 FileAlignment 通常是 `0x200`，也就是 512 bytes，這也是一個硬碟扇區的大小。而 x86 下 SectionAlignment 通常是 `0x1000`。

而 Section 開始的位址為 Base 的位址加上其偏移量，在硬碟中，Base 的位址為 0，偏移量則是 `PointerToRawData` 決定的，也就是 FOA。

在記憶體中，Base 的位址為 Imagebase 的位址，然而這是對第一個載入記憶體的 PE 而言，當 Imagebase 處已經有 PE 載入時，OS 會介入調整載入位址，因此我們常說 Imagebase 為「建議載入」位址，而記憶體中 Section 的偏移量則是 `VirtualAddress` 的數值，也就是 RVA，RVA 的數值加上 Base 的位址則是 Section 在記憶體上的位址，稱為 VA，因此 VA = RVA + Imagebase。

