---
title: RVOS OSDI 筆記
date: 2023/6/17a
abstract: 看 OSDI 網課的筆記，課程內介紹了一些 risc-v 常用的指令，並且小改了金門大學陳鐘誠老師的 [mini-riscv-os](https://github.com/cccriscv/mini-riscv-os) 來當作課程教材，一步一步的帶學生做了一個，我自己上完是覺得還不錯，所以就把整個過程記錄下來了
tags: OSDI
categories:
- OS
---

# RVOS OSDI 筆記

這是我在 bilibili 上面看一門叫做「[循序渐进，学习开发一个RISC-V上的操作系统 - 汪辰 - 2021春](https://www.bilibili.com/video/BV1Q5411w7z5/?spm_id_from=333.999.0.0&vd_source=493154d46ef9c42825a755d6b7857b3c)」的課的筆記

課程內介紹了一些 risc-v 常用的指令，並且小改了金門大學陳鐘誠老師的 [mini-riscv-os](https://github.com/cccriscv/mini-riscv-os) 來當作課程教材，一步一步的帶學生做了一個，我自己上完是覺得還不錯，所以就把整個過程記錄下來了

# 常用的 RISC-V 筆記

## 基本架構

一條典型的 RISC-V 語句由 3 部分組成：

> [ label: ] [ operation ] [ comment ]

三個都是可選的，因此可接受空行。 label 後面需接上冒號；operation 是比較重要的部分，真正的操作在這裡，裡面還可以分解；comment 是註釋。 

### label(標籤)

任何以冒號結尾的標示符都會被認為是一個標籤，看個例子

```asm
.macro do_nothing	# directive
	nop		# pseudo-instruction
	nop		# pseudo-instruction
.endm			# directive

	.text		# directive
	.global _start	# directive
_start: 		# Label
	li x6, 5	# pseudo-instruction
	li x7, 4	# pseudo-instruction
	add x5, x6, x7	# instruction
	do_nothing	# Calling macro
stop:	j stop		# statement in one line

	.end		# End of file
```

當中的 `_start:` 與 `stop` 就是 label，可以和後續的東西分成兩行寫，也可以寫同一行。 

label 可以想成幫一段位址取了一個名字，方便我們後續使用

### operation

operation 總共有四種變化：

+ instruction (指令)
    直接對應二進位的機器指令字符串
+ pseudo-instruction (偽指令)
    為了提高寫程式的效率，可以用一條偽指令指示組譯器產生多條實際的 instruction
+ directive (指示/偽操作)
    通過類似 instruction 的形式(以 「.」 開頭)，通知組譯器如何控制程式碼的產生，不對應具體的指令，是由組譯器定義的
+ macro
    採用 .macro/.endm 自定義的 macro

## 指令的操作對象

指令的操作對象可以分兩大類：

+ 暫存器
    + RV32I 中共有 32 個通用暫存器，x0~x31，還有一些特權暫存器，其中 x0 是 0 暫存器，不可寫，讀出來的值永遠為 0
    + 在 RISC-V 中，Hart 在執行算術邏輯運算時操作的數據需要直接來自暫存器
+ 記憶體
    + Hart 可以執行在暫存器和記憶體之間的數據讀寫操作
    + 讀寫操作使用 Byte 為基本單位尋址
    + RV32 可以訪問最多 $2^{32}$ 個 Byte 的記憶體空間

## 指令編碼格式

![](https://hackmd.io/_uploads/S1cMT1sw3.png)

指令最後會被翻譯為機器指令，裡面的 32 bits 都有對應的意思，以 32 bits 對齊，每個 32 bits 會照上面的圖被劃分為不同的區域(field)

最終的指令類型是由 funct3/funct7 和 opcode 一起決定的，題外話，funct3 中的 "3" 代表佔了 3 個 bit，funct7 同理。

對於 opcode 的部分有另一張表規定了其內容意義：

![](https://hackmd.io/_uploads/BytZakoP2.png)

opcode 的前兩位永遠為 11，而第 2~4 位是一組的，5~6 位是一組的，我們用一個例子來學習這個表格是怎麼看得：

> 0000000 rs2 rs1 000 rd 0110011 | ADD

這是 ADD 這個指令的機器碼範例，依照最前面的表格我們知道後面的 `0110011` 是 opcode，可以看見前兩位(最右邊)為 `11`

我們先看第 5~6 位，這裡是 `01`，因此我們去上表的左邊縱排找 `01`，之後看有哪些可能，有 STORE、STORE-FP、custom-1、AMO、OP、LUI、OP-32 這些

我們再依照第 2~4 位來確認位置，這裡是 `100`，對到表格上就是 `OP`，也就是說 ADD 屬於 `OP` 類型的指令，也就是基本操作

RISC-V 標準中為 little endian，假設在記憶體中的值為 `b3 05 95 00`，則需要先將其倒反過來為：`00 95 05 b3`，寫為二進制的話為 `00000000-10010101-00000101-10110011`，到標準中查表可知此指令為 `add x11, x10, x9`

![](https://hackmd.io/_uploads/B1PCAkiwn.png)

指令格式有 6 種，也就是第一張圖裡面的 R、I、S 那些：

+ R-type (register)
    每條指令中有三個 fields，用於指定 3 個暫存器參數
+ I-type (Immediate)
    每條指令除了帶有兩個暫存器參數以外，還帶有一個常數參數 (寬度為 12 bits)
+ S-type (Store)
    每條指令除了帶有兩個暫存器參數以外，還帶有一個常數參數 (寬度為 12 bits，但 fields 的組成方式不同於 I-type)
+ B-type (Branch)
    每條指令除了帶有兩個暫存器參數外，還有一個常數參數 (寬度為 12 bits，但取值為 2 的倍數)
+ U-type (Upper)
    每條指令含有一個暫存器參數和一個常數參數 (寬度為 20 bits，用來表示一個常數的高 20 位)
+ J-type (Jump)
    每條指令內有一個暫存器參數和一個常數參數 (寬度為 20 bits)


## 算術運算指令(Arithmetic Instruction)

### ADD

功能：將兩暫存器的值相加
語法：`ADD RD, RS1, RS2`
> 例：add x5, x6, x7 為 x5 = x6 + x7 

格式：R-type

![](https://hackmd.io/_uploads/SJELFY2Pn.png)

對應意義：
+ opcode(7)：0110011 (OP)
+ funct3 為 000，funct7 為 0000000
+ rs1(5)：第一個 operand (source register 1)
+ rs2(5)：第二個 operand (source register 2)
+ rd(5)：destination register，用於存放加出來的結果

### SUB

功能：將兩暫存器的值相減
語法：`SUB RD, RS1, RS2`
> 例：sub x5, x6, x7 為 x5 = x6 - x7 

格式同為 R-type

### ADDI (ADD Immediate)

功能：將暫存器中的值與一常數相加
語法： `ADDI RD, RS1, IMM`
> 例：addi x5, x6, 1  為 x5 = x6 + 1

格式：I-type

![](https://hackmd.io/_uploads/HJtbAY3Pn.png)

對應意義：

+ opcode (7)：0b0010011 (OP-IMM)
+ funct3 (3)：和 opcode 一起決定最終指令
+ rs1 (5)：第一個 opecrand (source register 1)
+ rd (5)：destination register，用於存放加出來的結果
+ imm (12)：immediate，常數，要注意只有 12 bits，所以範圍是有限的

在運算前 `imm` 會被 sign-extension 為一個 32 位的數，可以表達的範圍為 $-2^{11} ~ 2^{11}$，也就是 $[-2048, 2047)$

### LUI (Load Upper Immediate)

為了要加超過 12 bits 的常數，risc-v 引入了一個新的指令來「載入一個 32 bits 的常數」，作法是把一個 32 bits 的數切為高 20 位與低 12 位，之後先將高 20 位放到一個暫存器內，在利用 `ADDI` 將低 12 位的部分加上去

用來構造高 20 位的指令就是 `LUI`

功能：構造一個 32 bits 的常數，此常數高 20 位為 `imm` 的內容，低 12 位為 0，這個常數會作為結果存在 RD 中
語法：`LUI RD, IMM`
> 例：lui x5, 0x12345 為 x5 = 0x12345 << 12

格式：U-type

![](https://hackmd.io/_uploads/SyCVM9nP3.png)

對應意義：
+ opcode (7)：0b0110111 (LUI)
+ rd (5)：destination register，用於存放加出來的結果
+ imm (20)：immediate，常數

假設我們今天要載入 `0x12345678`，那步驟為：

```asm
lui x1, 0x12345     # x1 = 0x12345000
addi x1, x1, 0x678  # x1 = 0x12345678
```

但如果數字為 `0x12345FFF`，那在 `addi` 的部分會有問題，因為在 `addi` 運算前 `imm` 會被 sign-extension 為一個 32-bits 的數

所以如果是做 `addi x1, x1, 0xFFF`，那麼是不會得到 `0x12345FFF` 的，所以我們換個想法，提前先借位，步驟為：
```asm
lui x1, 0x12346    # x1 = 0x12346000
addi x1, x1, -1    # x1 = 0x12345FFF
```

### AUIPC

我們在構造一個位址的流程其實和建構一個普通的數值沒有太大的區別，可以用 `LUI` 和 `ADDI` 來做，但這樣建構出的會是一個直接指定好的常數，但在構造位址的時候我們還會希望有相對位址，所以就需要 `AUIPC`，名字中的 `PC` 指的是 program counter

功能：構造一個 32 bits 的常數，高 20 位為 `imm`，低 12 位為 0，但會將此常數與 `PC` 值相加，結果存於 RD
語法：`AUIPC RD, IMM`
> 例：auipc x5, 0x12345 為 x5 = 0x12345 << 12 + PC


### 相關的 pseudo-instruction

#### NEG

功能：對 RS 取負號，將結果存在 RD 中
語法：`NEG RD, RS`
等價指令：`SUB RD, x0, RS`
> 例：neg x5, x6

#### MV

功能：將 RS 中的值複製到 RD 中
語法：`MV RD, RS`
等價指令：`ADDI RD, RS, 0`
> 例：mv x5, x6

#### LI (Load Immediate)

因為用 `LUI` 在載入一個數時還要考慮提前借位的問題太麻煩了，所以就有了 `LI`

功能：載入一個常數，組譯器會根據 imm 的情況自動判斷要不要借位
語法：`LI RD, IMM`
> 例：li x5, 0x12345678 為 x5 = 0x12345678

#### LA (Load Address)

在寫 code 的時候給出需要載入的 label，組譯器會根據實際情況利用 `AUIPC` 和其他指令自動生成正確的指令來載入記憶體位址，常用於載入一個函式或變數的位址

功能：載入一個地址
語法：`LA RD, LABEL`
> 例：la x5, foo

#### NOP (空指令)

功能：不做任何事
語法：`NOP`
等價指令：`ADDI x0, 0, 0`
> 例：nop

## 邏輯運算指令 (Logical Instructions)

### AND

功能：`RD = RS1 & RS2`
語法：`AND RD, RS1, RS2`
格式：R-type
> 例：and x5, x6, x7

### OR

功能：`RD = RS1 | RS2`
語法：`OR RD, RS1, RS2`
格式：R-type
> 例：or x5, x6, x7

### XOR

功能：`RD = RS1 ^ RS2`
語法：`XOR RD, RS1, RS2`
格式：R-type
> 例：xor x5, x6, x7

### ANDI

功能：`RD = RS1 & IMM`
語法：`ANDI RD, RS1, IMM`
格式：I-type
> 例：`andi x5, x6, 20`

### ORI

功能：`RD = RS1 | IMM`
語法：`ORI RD, RS1, IMM`
格式：I-type
> 例：`ori x5, x6, 20`

### XORI

功能：`RD = RS1 ^ IMM`
語法：`XORI RD, RS1, IMM`
格式：I-type
> 例：`xori x5, x6, 20`

### 相關的 pseudo-instruction

#### NOT

功能：對 RS 做 Bitwise Complement，將結果存在 RD 中
語法：`NOT RD, RS`
等價指令：`XORI RD, RS, -1`
> 例：not x5, x6

## 移位運算指令 (Shifting Instructions)

### SLL (邏輯左移)

補 0

功能：`RD = RS1 << RS2`
語法：`SLL RD, RS1, RS2`
格式：R-type
> 例：sll x5, x6, x7

### SRL (邏輯右移)

補 0

功能：`RD = RS1 >> RS2`
語法：`SRL RD, RS1, RS2`
格式：R-type
> 例：srl x5, x6, x7

### SLLI (邏輯左移常數)

補 0

功能：`RD = RS1 << IMM`
語法：`SLLI RD, RS1, IMM`
格式：I-type
> 例：slli x5, x6, 3

### SRLI (邏輯右移常數)

補 0

功能：`RD = RS1 >> IMM`
語法：`SRLI RD, RS1, IMM`
格式：I-type
> 例：srli x5, x6, 3

### SRA (算術右移)

按符號位補足

功能：`RD = RS1 >> RS2`
語法：`SRA RD, RS1, RS2`
格式：R-type
> 例：sra x5, x6, x7

### SRAI (算術右移常數)

按符號位補足

功能：`RD = RS1 >> IMM`
語法：`SRAI RD, RS1, IMM`
格式：I-type
> 例：srai x5, x6, 3

## 記憶體讀寫指令 (Load and Store Instructions)

### LB

`IMM` 範圍為 $[-2048, 2047]$，資料在保存到 RD 前會執行 sign-extension

功能：Load Byte，從記憶體中讀一個 8 bits 的數據到 RD 中，記憶體位址為 `RS1 + IMM`
語法：`LB RD, IMM(RS1)`
格式：I-type
> 例：lb x5, 40(x6)

### LBU

`IMM` 範圍為 $[-2048, 2047]$，資料在保存到 RD 前會執行 zero-extension

功能：Load Byte Unsigned，從記憶體中讀一個 8 bits 的數據到 RD 中，記憶體位址為 `RS1 + IMM`
語法：`LBU RD, IMM(RS1)`
格式：I-type
> 例：lbu x5, 40(x6)

### LH

`IMM` 範圍為 $[-2048, 2047]$，資料在保存到 RD 前會執行 sign-extension

功能：Load Halfword，從記憶體中讀一個 16 bits 的數據到 RD 中，記憶體位址為 `RS1 + IMM`
語法：`LH RD, IMM(RS1)`
格式：I-type
> 例：lh x5, 40(x6)

### LHU

`IMM` 範圍為 $[-2048, 2047]$，資料在保存到 RD 前會執行 zero-extension

功能：Load Halfword Unsigned，從記憶體中讀一個 16 bits 的數據到 RD 中，記憶體位址為 `RS1 + IMM`
語法：`LHU RD, IMM(RS1)`
格式：I-type
> 例：lhu x5, 40(x6)

### LW

`IMM` 範圍為 $[-2048, 2047]$

功能：Load Word，從記憶體中讀一個 32 bits 的數據到 RD 中，記憶體位址為 `RS1 + IMM`
語法：`LW RD, IMM(RS1)`
格式：I-type
> 例：lw x5, 40(x6)

### SB

`IMM` 範圍為 $[-2048, 2047]$

功能：Store Byte，將 RS2 中低 8 bits 的資料寫到記憶體中，記憶體位址為 `RS1 + IMM`
語法：`SB RS2, IMM(RS1)`
格式：S-type
> 例：sb x5, 40(x6)

### SH

`IMM` 範圍為 $[-2048, 2047]$

功能：Store Halfword，將 RS2 中低 16 bits 的資料寫到記憶體中，記憶體位址為 `RS1 + IMM`
語法：`SH RS2, IMM(RS1)`
格式：S-type
> 例：sh x5, 40(x6)

### SW

`IMM` 範圍為 $[-2048, 2047]$

功能：Store Word，將 RS2 中低 32 bits 的資料寫到記憶體中，記憶體位址為 `RS1 + IMM`
語法：`SW RS2, IMM(RS1)`
格式：S-type
> 例：sw x5, 40(x6)

## 分支指令 (Conditional Branch Instructions)

### BEQ

跳轉的目標地址計算方法為：先將 IMM * 2，符號擴展後和 PC 值相加得到最終的目標位址，所以跳轉的範圍是以 PC 為基準，加減 4KB 左右 ($[-4096, 4094]$)

實際上在寫的時候不會直接寫常數，而是會寫標籤帶體，交由 Linker 決定最終的 `IMM` 值

功能：Branch if EQual，比較 RS1 和 RS2 的值，若相等，執行路徑跳轉到新的地址
語法：`BEQ RS1, RS2, IMM`
格式：B-type
> 例：beq x5, x6, 100

### BNE

跳轉的目標地址計算方法為：先將 IMM * 2，符號擴展後和 PC 值相加得到最終的目標位址，所以跳轉的範圍是以 PC 為基準，加減 4KB 左右 ($[-4096, 4094]$)

實際上在寫的時候不會直接寫常數，而是會寫標籤帶體，交由 Linker 決定最終的 `IMM` 值

功能：Branch if Not Equal，比較 RS1 和 RS2 的值，若不相等，則執行路徑跳轉到新的地址
語法：`BNE RS1, RS2, IMM`
格式：B-type
> 例：bne x5, x6, 100

### BLT

跳轉的目標地址計算方法為：先將 IMM * 2，符號擴展後和 PC 值相加得到最終的目標位址，所以跳轉的範圍是以 PC 為基準，加減 4KB 左右 ($[-4096, 4094]$)

實際上在寫的時候不會直接寫常數，而是會寫標籤帶體，交由 Linker 決定最終的 `IMM` 值

功能：Branch if Less Than，依照「有號」方式比較 RS1 和 RS2 的值，若 RS1 < RS2，則執行路徑跳轉到新的地址
語法：`BLT RS1, RS2, IMM`
格式：B-type
> 例：blt x5, x6, 100

### BLTU

跳轉的目標地址計算方法為：先將 IMM * 2，符號擴展後和 PC 值相加得到最終的目標位址，所以跳轉的範圍是以 PC 為基準，加減 4KB 左右 ($[-4096, 4094]$)

實際上在寫的時候不會直接寫常數，而是會寫標籤帶體，交由 Linker 決定最終的 `IMM` 值

功能：Branch if Less Than (Unsigned)，依照「無號」方式比較 RS1 和 RS2 的值，若 RS1 < RS2，則執行路徑跳轉到新的地址
語法：`BLTU RS1, RS2, IMM`
格式：B-type
> 例：bltu x5, x6, 100

### BGE

跳轉的目標地址計算方法為：先將 IMM * 2，符號擴展後和 PC 值相加得到最終的目標位址，所以跳轉的範圍是以 PC 為基準，加減 4KB 左右 ($[-4096, 4094]$)

實際上在寫的時候不會直接寫常數，而是會寫標籤帶體，交由 Linker 決定最終的 `IMM` 值

功能：Branch if Greater than or Equal，依照「有號」方式比較 RS1 和 RS2 的值，若 RS1 >= RS2，則執行路徑跳轉到新的地址
語法：`BGE RS1, RS2, IMM`
格式：B-type
> 例：bge x5, x6, 100

### BGEU

跳轉的目標地址計算方法為：先將 IMM * 2，符號擴展後和 PC 值相加得到最終的目標位址，所以跳轉的範圍是以 PC 為基準，加減 4KB 左右 ($[-4096, 4094]$)

實際上在寫的時候不會直接寫常數，而是會寫標籤帶體，交由 Linker 決定最終的 `IMM` 值

功能：Branch if Greator than or Equal (Unsigned)，依照「無號」方式比較 RS1 和 RS2 的值，若 RS1 >= RS2，則執行路徑跳轉到新的地址
語法：`BGEU RS1, RS2, IMM`
格式：B-type
> 例：bgeu x5, x6, 100

### 相關的 pseudo-instruction

### BLE

功能：Branch if Less and Equal，有號方式比較，如果 RS <= RT，跳轉到 OFFSET
語法：`BLE RS, RT, OFFSET`
等價指令：`BGE RT, RS, OFFSET`

### BLEU

功能：Branch if Less or Equal Unsigned，無號方式比較，如果 RS <= RT，跳轉到 OFFSET
語法：`BLEU RS, RT, OFFSET`
等價指令：`BGEU RT, RS, OFFSET`

### BGT

功能：Branch if Greater Than，有號方式比較，如果 RS > RT，跳轉到 OFFSET
語法：`BGT RS, RT, OFFSET`
等價指令：`BLT RT, RS, OFFSET`

### BGTU

功能：Branch if Greator Than Unsigned，無號方式比較，如果 RS > RT，跳轉到 OFFSET
語法：`BGTU RS, RT, OFFSET`
等價指令：`BLTU RT, RS, OFFSET`

### BEQZ

功能：Branch if Equal Zero，如果 RS == 0，跳轉到 OFFSET
語法：`BEQZ RS, OFFSET`
等價指令：`BEQ RS, x0, OFFSET`

### BNEZ

功能：Branch if Not Equal Zero，如果 RS != 0，跳轉到 OFFSET
語法：`BNEZ RS, OFFSET`
等價指令：`BNE RS, x0, OFFSET`

### BLTZ

功能：Branch if Less Than Zero，如果 RS < 0，跳轉到 OFFSET
語法：`BLT RS, x0, OFFSET`
等價指令：`BLT RS, x0, OFFSET`

### BLEZ

功能：Branch if Less or Equal Than Zero，如果 RS <= 0，跳轉到 OFFSET
語法：`BLEZ RS, OFFSET`
等價指令：`BGE x0, RS, OFFSET`

### BGTZ

功能：Branch if Greater Than Zero，如果 RS > 0，跳轉到 OFFSET
語法：`BGTZ RS, OFFSET`
等價指令：`BLT x0, RS, OFFSET`

### BGEZ

功能：Branch if Greater or Equal Zero，如果 RS >= 0，跳轉到 OFFSET
語法：`BGEZ RS, OFFSET`
等價指令：`BGE RS, x0, OFFSET`

## 無條件跳轉 (Unconditional Jump Instructions)

### JAL (Jump And Link)

功能：跳轉到目標位址，用於呼叫函式 
語法：`JAL RD, LABEL`
格式：J-type
> 例：jal x1, label

![](https://hackmd.io/_uploads/r1De6yAPh.png)

調用函式時地址的計算方法為先對 20 bits 寬的 `IMM` 乘以 2，然後進行 sign-extension，最後與 PC 相加，因此跳轉的範圍是以 PC 為基準，上下加減 1 MB

JAL 指令的下一條指令的地址會寫入 RD，保存為返回位址，實際在寫時會用 label 給出跳轉的目標，具體 `IMM` 值由組譯器和 linker 負責生成。

### JALR (Jump And Link Register)

功能：跳轉到目標位址，用於呼叫函式
語法：`JALR RD, IMM (RS1)`
格式：I-type
> 例：jalr x0, 0(x5)

![](https://hackmd.io/_uploads/HylR0JAD3.png)

調用函式時地址的計算方法為先對 12 bits 寬的 `IMM` 進行 sign-extension，然後將其與 RS1 的值相加，得到最終的結果後將其最低位設為 0 (用以確保對齊)，因此跳轉的範圍是以 RS1 為基準，上下加減 2KB

# OS Development

## 讀取 CSR

我使用 Qemu 來模擬板子，為了方便先以單核為目標，所以首要目標是怎麼確認當前核心是不是要用的核心

RISC-V 中，每一個 privilege level 都對應到一組特定的暫存器，被稱為控制暫存器，簡稱 CSR，從這個暫存器中我們可以讀取 Hart 的編號，高 level 可以訪問低 level，但反過來不行。

要訪問 CSR，我們需要使用 CSR 擴展指令

首先要看的是 Machine 模式下的 CSR 列表，因為 CPU 一上電時默認是在 machine 模式下，有點類似 x86 的 real mode：

![](https://hackmd.io/_uploads/r1WlAxCw2.png)

可以看見前面有與 Hart ID 相關的暫存器，像是 `mvendorid`、`marchid` 等，那接下來要看怎麼讀：

![](https://hackmd.io/_uploads/B1Qm1W0v2.png)

我們關心的是前兩個，先看 CSRRW (Atomic Read/Write CSR)：

+ CSRRW
    + 會先讀出 CSR 中的值，將其按 XLEN 位的寬度進行 zero-extensio 後寫入 RD，然後 RS1 中的值寫入 CSR
    + 為原子操作 (atomically)
    + 如果 RD 是 x0，則不讀 CSR
    + 語法：`CSRRW RD, CSR, RS1`
    + 例子：`csrrw t6, mscratch, t6` 為 `t6 = mscratch; mscratch = t6`(交換值)
+ CSRW
    + 由 CSRRW 來的 pseudo-instruction
    + 用來寫 CSR
    + 語法為：`csrw csr, rs`
    + 等價指令為：`csrrw x0, csr, rs`

接下來是 CSRRS (Atomic Read and Set Bits in CSR)：

+ CSRRS
    + 會先讀出 CSR 中的值，將其按 XLEN 位的寬度進行 zero-extensio 後寫入 RD，然後逐位檢查 RS1 中的值，如果某一位為 1 則將 CSR 的對應位置設為 1，否則保持不變
    + 為原子操作 (atomically)
    + 語法為：`CSRRS RD, CSR, RS1`
    + 例子：`csrrs x5, mie, x6` 為 `x5 = mie; mie |= x6` (做 mask)

+ CSRR
    + 由 CSRRS 來的 pseudo-instruction
    + 用來讀取 CSR
    + 與法為 `csrr rd, csr`
    + 等價指令為：`csrrs rd, csr, x0`

所以一開始就先去讀 machine 模式下存有 Hart ID 的暫存器，這個暫存器為 `mhartid`，它包含了運行當前指令的 Hart 的 ID

標準中有規定多個 Hart 的 ID 必須是唯一的，而且必須有一個 Hart ID 為 0 (第一個 Hart 的 ID)，所以我們就找 0 的那個用就好：

```asm
_start:
    csrr t0, mhartid
    bnez t0, park
    
park:
    wfi
    j park
```

這邊做的事為讀取 `mhartid`，如果不是 0，就跳到下方標籤處做 `wfi`(Wait for Interrupt)，Hart 執行到 `wfi` 後會進入類似休眠的狀態

接下來下一件事是想辦法進到 C 語言的環境中，設定好 stack 後直接 jump 到 main function 就好：

```asm
#include "platform.h"

	# size of each hart's stack is 1024 bytes
	.equ	STACK_SIZE, 1024

	.global	_start

	.text
_start:
	# park harts with id != 0
	csrr	t0, mhartid		# read current hart id
	mv	tp, t0			# keep CPU's hartid in its tp for later usage.
	bnez	t0, park		# if we're not on the hart 0
					# we park the hart
	# Setup stacks, the stack grows from bottom to top, so we put the
	# stack pointer to the very end of the stack range.
	slli	t0, t0, 10		# shift left the hart id by 1024
	la	sp, stacks + STACK_SIZE	# set the initial stack pointer
					# to the end of the first stack space
	add	sp, sp, t0		# move the current hart stack pointer
					# to its place in the stack space

	j	start_kernel		# hart 0 jump to c

park:
	wfi
	j	park

stacks:
	.skip	STACK_SIZE * MAXNUM_CPU # allocate space for all the harts stacks

	.end				# End of file
```

## 設定 UART

為了方便後面 Debug，接下來的目標是要能夠顯示訊息在螢幕上，我們這邊使用 uart 來傳輸數據，將訊息從板子上傳送到主機上，並在主機上顯示出來

UART 全名為 Universal Asynchronous Receiver and Transmitter，是一種 Serial communication，代表會一位一位的發送和接收數據，因此需要設定波特率(baud rate)，數字越大發送越快；另外 UART 還支援非同步與全雙工

這邊簡單看一下 UART 的通訊協議：

+ 空閒位：空閒時處於高電位
+ 起始位：開始發送時發送方(TX) 要先發出一個低電位(0)來表示傳輸字符的開始
+ 數據位：起始位之後就是要傳輸的數據，數據長度(word length) 可以事 5/6/7/8/9 位，構成一個字符，一般是 8 位。先發送最低位，最後發送最高位
+ 奇偶檢查位(parity)：分幾種檢查方式：
    + 無檢查(no parity)
    + 奇檢驗(odd parity)：如果數據中 1 的數目為偶數，則檢驗位為 1，反之為 0
    + 偶檢驗(even parity)：如果數據中 1 的數目是偶數，則檢驗位為 0，反之為 1
    + mark parity：檢驗位始終為 1
    + space parity：檢驗位始終為 0
+ 停止位：數據結束的標誌，可以是 1 位、1.5 位、2 位的高電位

在 QEMU 中 UART 記憶體映射的起始位址在 `0x10000000L`，總共提供了 8 個暫存器，每個暫存器是 8 bits 的，根據起始位址我們可以設定使用暫存器的 macro：

```c
/*
 * The UART control registers are memory-mapped at address UART0. 
 * This macro returns the address of one of the registers.
 */
#define UART_REG(reg) ((volatile uint8_t *)(UART0 + reg))

/*
 * UART control registers map. see [1] "PROGRAMMING TABLE"
 * note some are reused by multiple functions
 * 0 (write mode): THR/DLL
 * 1 (write mode): IER/DLM
 */
#define RHR 0	// Receive Holding Register (read mode)
#define THR 0	// Transmit Holding Register (write mode)
#define DLL 0	// LSB of Divisor Latch (write mode)
#define IER 1	// Interrupt Enable Register (write mode)
#define DLM 1	// MSB of Divisor Latch (write mode)
#define FCR 2	// FIFO Control Register (write mode)
#define ISR 2	// Interrupt Status Register (read mode)
#define LCR 3	// Line Control Register
#define MCR 4	// Modem Control Register
#define LSR 5	// Line Status Register
#define MSR 6	// Modem Status Register
#define SPR 7	// ScratchPad Register
```

如此一來我們就能使用這些暫存器了，重複的代表那個暫存器有多個功能，至於各個暫存器的功用要去看 NS16550a 的手冊

而要對暫存器讀寫也很簡單，只要這樣就好：

```c
#define uart_read_reg(reg) (*(UART_REG(reg)))
#define uart_write_reg(reg, v) (*(UART_REG(reg)) = (v))
```

接下來要初始化 UART，首先先禁用 interrupt，因為後面才會用到：

```c
/* disable interrupts. */
uart_write_reg(IER, 0x00);
```

然後要設定波特率(baud rate)：

```c
uint8_t lcr = uart_read_reg(LCR);
uart_write_reg(LCR, lcr | (1 << 7)); // 啟用波特率調整
uart_write_reg(DLL, 0x03); // 低位
uart_write_reg(DLM, 0x00); // 高位
```

還有檢查位：
```c
lcr = 0;
uart_write_reg(LCR, lcr | (3 << 0));
```

接下來來處理發送數據：

```c
#define LSR_TX_IDLE  (1 << 5)
int uart_putc(char ch)
{
  while ((uart_read_reg(LSR) & LSR_TX_IDLE) == 0); // busy waiting 等待 THR 為空 
  return uart_write_reg(THR, ch); // 將資料寫入 THR
}
```

如此一來可以傳輸一個字，而要傳送一個字串的話就每個字節都呼叫一次就好：

```c
void uart_puts(char *s)
{
  while (*s) {
    uart_putc(*s++);
  }
}
```



## 記憶體管理

這樣資料的傳輸就搞定了，接下來要處理記憶體，實現動態的記憶體分配和釋放，還有簡單的 page

首先來設定記憶體區段，這部份我們可以用 gcc link script 完成：

```ld
MEMORY
{
    ram   (wxa!ri) : ORIGIN = 0x80000000, LENGTH = 128M
}

SECTIONS
{
    .text : {
        PROVIDE(_text_start = .);
        *(.text .text.*)
        PROVIDE(_text_end = .);
    } >ram
    
    .rodata : {
        PROVIDE(_rodata_start = .);
        *(.rodata .rodata.*)
        PROVIDE(_rodata_end = .);
    } >ram
    
    .data : {
        . = ALIGN(4096);
        PROVIDE(_data_start = .);
        *(.sdata .sdata.*)
        *(.data .data.*)
        PROVIDE(_data_end = .);
    } >ram	
    
    .bss :{
        PROVIDE(_bss_start = .);
        *(.sbss .sbss.*)
        *(.bss .bss.*)
        *(COMMON)
        PROVIDE(_bss_end = .);
    } >ram	
    
    PROVIDE(_memory_start = ORIGIN(ram));
    PROVIDE(_memory_end = ORIGIN(ram) + LENGTH(ram));	
    PROVIDE(_heap_start = _bss_end);
    PROVIDE(_heap_size = _memory_end - _heap_start);
}
```

因為 link script 的變數會被添加到 symbol table 內，因此在 asm、C 語言中我們是可以使用的：

asm：
```asm
.section .rodata
.global HEAP_START
HEAP_START: .word _heap_start

.global HEAP_SIZE
HEAP_SIZE: .word _heap_size

.global TEXT_START
TEXT_START: .word _text_start

.global TEXT_END
TEXT_END: .word _text_end

.global DATA_START
DATA_START: .word _data_start

.global DATA_END
DATA_END: .word _data_end

.global RODATA_START
RODATA_START: .word _rodata_start

.global RODATA_END
RODATA_END: .word _rodata_end

.global BSS_START
BSS_START: .word _bss_start

.global BSS_END
BSS_END: .word _bss_end
```

C：
```c
extern uint32_t TEXT_START;
extern uint32_t TEXT_END;
extern uint32_t DATA_START;
extern uint32_t DATA_END;
extern uint32_t RODATA_START;
extern uint32_t RODATA_END;
extern uint32_t BSS_START;
extern uint32_t BSS_END;
extern uint32_t HEAP_START;
extern uint32_t HEAP_SIZE;
```

如此一來記憶體區段就分配好了，也可以在 C 中使用了，接下來要來實現簡單的 page，一個 page 分配為 4k

這邊使用陣列來實作 page 的管理：

![](https://hackmd.io/_uploads/S11GS4AD3.png)

前方紅藍的部分為管理對應 page 狀態的區域，後方白色的是一個一個的 page

前方紅藍部分的定義如下：

```c
#define PAGE_TAKEN (uint8_t)(1 << 0)
#define PAGE_LAST  (uint8_t)(1 << 1)
struct Page {
    uint8_t flags;
};
```

`flags` 的第一個 bit 代表是否有被使用中，第二個 bit 代表是否為連續區塊的最後一個 page，接下來我們來寫檢測狀態的 API

將 page 狀態清空：
```c
static inline void _clear(struct Page *page)
{
    page->flags = 0;
}
```

確認 page 是否有人在使用：
```c
static inline int _is_free(struct Page *page)
{
    if (page->flags & PAGE_TAKEN) {
        return 0;
    }
    else {
        return 1;
    }
}
```

設定 page 狀態：

```c
static inline void _set_flag(struct Page *page, uint8_t flags)
{
    page->flags |= flags;
}
```

確認是否為連續區塊的最後一個 page：
```c
static inline int _is_last(struct Page *page)
{
    if (page->flags & PAGE_LAST) {
        return 1;
    }
    else {
        return 0;
    }
}
```

對齊 page：

```c
static inline uint32_t _align_page(uint32_t address)
{
    uint32_t order = (1 << PAGE_ORDER) - 1;
    return (address + order) & (~order);
}
```

有了這些之後我們就可以來寫怎麼分配和釋放 page 了，首先是分配 page：

```c
void *page_alloc(int npages)
{
    int found = 0;
    struct Page *page_i = (struct Page *)HEAP_START;
    for (int i = 0; i <= (_num_pages - npages); i++) {
        if (_is_free(page_i)) {
            found = 1;
            struct Page *page_j = page_i + 1;
            for (int j = i + 1; j < (i + npages); j++) {
            	if (!_is_free(page_j)) {
            	    found = 0;
            	    break;
            	}
            	page_j++;
            }
            
            if (found) {
            	struct Page *page_k = page_i;
            	for (int k = i; k < (i + npages); k++) {
                    _set_flag(page_k, PAGE_TAKEN);
            	    page_k++;
            	}
            	page_k--;
            	_set_flag(page_k, PAGE_LAST);
            	return (void *)(_alloc_start + i * PAGE_SIZE);
            }
        }
        page_i++;
    }
    return NULL;
}
```

`npages` 代表我們需要幾個 page，我們會分配連續的回傳，假設是 4，那就會是一個大小為 4 個 page 的連續記憶體

邏輯很簡單，根據前面寫好的 API，循訪前方的狀態區塊，檢查其是否為空與是否是最後一個區塊，條件符合的話便將其標記為使用中並回傳開頭位址

釋放也是同樣邏輯，循訪前方的狀態區塊，將對應的 page 釋放，並檢查其是否已為最後一個區塊：

```c
void page_free(void *p)
{
    if (!p || (uint32_t)p >= _alloc_end) {
        return;
    }
    /* get the first page descriptor of this memory block */
    struct Page *page = (struct Page *)HEAP_START;
    page += ((uint32_t)p - _alloc_start)/ PAGE_SIZE;
    /* loop and clear all the page descriptors of the memory block */
    while (!_is_free(page)) {
        if (_is_last(page)) {
            _clear(page);
            break;
        } 
        else {
            _clear(page);
            page++;
        }
    }
}
```

## multitask and context switch

### multitask

一個 task 的本質是函式的執行過程，也就是一個指令的 flow；假如我們今天不同的 Hart 上面都有跑一個函式與對應的子函式，這種情況就可以算是一個最簡單的多任務了

那假設我們現在只有一個 Hart，但卻想要能夠實現多任務怎麼辦? 我們可以讓兩個 task 在同一個 Hart 上輪流執行

我們前面已經提到，執行的狀態是利用暫存器來儲存的，因此我們只要將任務當前使用的暫存器的值給儲存下來，就相當於是把它執行的狀態儲存起來了

透過改變這些暫存器的值，我們就可以改變目前執行的 task 了，也就可以只用一個 Hart 實現多任務了

當前 task 的狀態有個名詞，我們稱它為 context，中文翻為上下文

為了儲存上下文，我們可以定義一個 struct，將 context 使用到的 struct 都儲存起來：

```c
struct context {
    /* ignore x0 */
    reg_t ra;
    reg_t sp;
    reg_t gp;
    reg_t tp;
    reg_t t0;
    reg_t t1;
    reg_t t2;
    reg_t s0;
    reg_t s1;
    reg_t a0;
    reg_t a1;
    reg_t a2;
    reg_t a3;
    reg_t a4;
    reg_t a5;
    reg_t a6;
    reg_t a7;
    reg_t s2;
    reg_t s3;
    reg_t s4;
    reg_t s5;
    reg_t s6;
    reg_t s7;
    reg_t s8;
    reg_t s9;
    reg_t s10;
    reg_t s11;
    reg_t t3;
    reg_t t4;
    reg_t t5;
    reg_t t6;
};
```

這邊因為 `x0` 的值是不變的所以就忽略它了

### type of multitask

多任務可以分成兩種實現方式：協作式與搶占式的多任務，兩者的差別在於交換 context 的方法不一樣

+ 協作式多任務(Cooperative Multitasking)
    目前正在執行的 task 會主動放棄 Hart，呼叫下一個 task，讓下一個 task 來使用 CPU
    
+ 搶占式多任務(Preemptive Multitasking)
    由 OS 來決定哪個 task 來使用 CPU，OS 可以剝奪當前 task 對處理器的使用，將處理器交給其他的 task
    
目前主流的 OS 都是使用 Preemtive Multitasking，早期的 OS 才會使用 Cooperative Multitasking 這種方法

Cooperative Multitasking 有很大的壞處是「放棄 Hart，讓下一個 task 來使用 CPU」這件事是需要 Programmer 自己做的，因此當你程式沒寫好，發生無窮迴圈這類的情況時，當前的 task 就無法放棄 Hart，也就會讓電腦整個死當

但由於實作上較為簡單，因此我們這邊就先實作 Cooperative Multitasking，後面再實作 Preemtive Multitasking

### Cooperative Multitasking

前面提到了一個 task 的本質是一堆指令的序列，假設這邊有 Task A 和 B，在 Cooperative Multitasking 的情況下他們會長這樣：

![image](https://hackmd.io/_uploads/HyMCrpFd6.png)

可以看見兩個 Task 內都是由指令序列組成的(Instruction i)，中間有一個指令是 `call switch_to`，這就是讓下一個 task 來使用 CPU 的 function

那我們就來看一下這個 `switch_to` 裡面到底做了什麼：

![image](https://hackmd.io/_uploads/ryxSLTFuT.png)

步驟是：

1. 將目前的 context 儲存起來
2. 切換 context
3. 載入新任務的 context
4. return

在這張圖裡面我們只有一個 CPU，我們知道 CPU 內有很多暫存器，像是通用暫存器和一些 csr，也就是控制狀態暫存器，在這邊我們關心兩個暫存器：

1. `ra`
    跟 return 指令有關，用來存放返回的位址
2. `mscratch`
    這是一個 machine 下的暫存器，紀錄(指向)目前的 context
    
為了讓 `mscratch` 可以指向 context，我們需要給 context 分配記憶體空間，保存該 context 的暫存器內容，也就是對應到上面寫的那個 `struct context`

上圖假設了 Context 會被初始化為第一條指令的位址，因此左下角的 ra 中存的是 `i`，而右下角的 ra 中存的是 `j`

初始化好了之後就可以初始化 `mscratch` 暫存器，假設第一個載入的 task 是 A，那 `mscratch` 就會指向 A 的 context

之後開始執行 task 的內容，因此 PC 指標會一個指令一個指令的的跑下來，當 A 執行到 `switch_to` 的時候就會開始跑交換 context 的流程

前面有提到 `call` 這個指令執行的時候是會把下一條指令的位址放到 ra 裡面去的，因此 `i+M` 會被放到 ra 裡面去：

![image](https://hackmd.io/_uploads/rkjDtpFuT.png)

接下來就可以開始執行 `switch_to` 的內容，根據前面的步驟，第一步是儲存當前的 context，會將剛剛 `struct context` 內列出的暫存器內容全部從 CPU 儲存起來到 context A 的記憶體中

![image](https://hackmd.io/_uploads/r1RcK6tOp.png)

下一步是切換 context，改變 CPU 的 ra 就可以了：

![image](https://hackmd.io/_uploads/S1gbqaK_6.png)

下一步是 restore，也就是要載入 Task B 的暫存器內容：

![image](https://hackmd.io/_uploads/BJq4caFdp.png)

最後是 return，前面有提到 `ret` 這個指令會跳回到 `ra` 暫存器儲存的記憶體位址，這邊已經被我們改成 Instruction j 了，因此就會切換到 Task B 了

看完了邏輯，就來看一下 code 該怎麼寫，因為 `switch_to` 這個函式執行效率需要非常高，因此這邊就用 asm 來寫：

```asm
# void switch_to(struct context *next);
# a0: pointer to the context of the next task
.globl switch_to
.balign 4
switch_to:
    csrrw	t6, mscratch, t6	# swap t6 and mscratch
    beqz	t6, 1f			# Note: the first time switch_to() is
                                    # called, mscratch is initialized as zero
                    # (in sched_init()), which makes t6 zero,
                    # and that's the special case we have to
                    # handle with t6
    reg_save t6			# save context of prev task

    # Save the actual t6 register, which we swapped into
    # mscratch
    mv	t5, t6		# t5 points to the context of current task
    csrr	t6, mscratch	# read t6 back from mscratch
    sw	t6, 120(t5)	# save t6 with t5 as base

    1:
    # switch mscratch to point to the context of the next task
    csrw	mscratch, a0

    # Restore all GP registers
    # Use t6 to point to the context of the new task
    mv	t6, a0
    reg_restore t6

    # Do actual context switching.
    ret
.end
```
 
這段相當於寫了一個 C 的函式 `switch_to(struct context *next)`，參數前面有提到是放在 `a0` 這個暫存器裡面的

切換的部分是使用 `csrw` 指令來做的，這個指令前面有講過就是對 csr 暫存器進行寫操作，因此這邊就是把 `a0` 寫入 `mscratch` 中：

```asm
csrw    mscratch, a0
```

而 `reg_save` 是一個 macro，會將 CPU 的暫存器內容儲存到記憶體內對應的 struct：

```asm
.macro reg_save base
    sw ra, 0(\base)
    sw sp, 4(\base)
    sw t0, 16(\base)
    sw t1, 20(\base)
    sw t2, 24(\base)
    sw s0, 28(\base)
    sw s1, 32(\base)
    sw a0, 36(\base)
    sw a1, 40(\base)
    sw a2, 44(\base)
    sw a3, 48(\base)
    sw a4, 52(\base)
    sw a5, 56(\base)
    sw a6, 60(\base)
    sw a7, 64(\base)
    sw s2, 68(\base)
    sw s3, 72(\base)
    sw s4, 76(\base)
    sw s5, 80(\base)
    sw s6, 84(\base)
    sw s7, 88(\base)
    sw s8, 92(\base)
    sw s9, 96(\base)
    sw s10, 100(\base)
    sw s11, 104(\base)
    sw t3, 108(\base)
    sw t4, 112(\base)
    sw t5, 116(\base)
    # we don't save t6 here, due to we have used
    # it as base, we have to save t6 in an extra step
    # outside of reg_save
.endm
```
而 `reg_restore` 也是一個 macro，用處是將記憶體中對應的 struct 內容回復到 CPU 中：

```asm
.macro reg_restore base
    lw ra, 0(\base)
    lw sp, 4(\base)
    lw t0, 16(\base)
    lw t1, 20(\base)
    lw t2, 24(\base)
    lw s0, 28(\base)
    lw s1, 32(\base)
    lw a0, 36(\base)
    lw a1, 40(\base)
    lw a2, 44(\base)
    lw a3, 48(\base)
    lw a4, 52(\base)
    lw a5, 56(\base)
    lw a6, 60(\base)
    lw a7, 64(\base)
    lw s2, 68(\base)
    lw s3, 72(\base)
    lw s4, 76(\base)
    lw s5, 80(\base)
    lw s6, 84(\base)
    lw s7, 88(\base)
    lw s8, 92(\base)
    lw s9, 96(\base)
    lw s10, 100(\base)
    lw s11, 104(\base)
    lw t3, 108(\base)
    lw t4, 112(\base)
    lw t5, 116(\base)
    lw t6, 120(\base)
.endm
```

接下來只要在 user program 裡面呼叫 `switch_to` 就可以進行 context switch 了，這邊就不寫出來了

## Trap & Exception

既然要講 Preemtive Multitasking，那就需要中斷的概念

### 異常控制流(Exceptional Control Flow)

控制流(Control Flow) 這個名詞代表程式執行的過程，正常的控制流代表著使用者自己寫的指令

但是一旦有了中斷，程式在執行時就不會只跑使用者寫的指令，因為 OS 會將中斷插入進來影響程式的執行

這樣的過程被稱為異常控制流，簡稱為 ECP，分為兩種：異常(Exception) 與中斷(Interrupt)；在 risc-v 內統一把 ECP 稱為 Trap

### Machine mode 下的 CSR

因為我們這邊 OS 是寫在 Machine mode 下的，因此就看 Machine mode 下的 CSR：

![image](https://hackmd.io/_uploads/rycyE9qOT.png)

然後我們把跟 Trap 有關的整理出來：

+ mtvec (Machine Trap-Vector Base-Address)
    + 保存發生異常時楚利器需要跳轉到的位址
+ mepc (Machine Exception Program Counter)
    + 當 trap 發生時，Hart 會將發生 trap 所對應的指令的位址(pc) 保存在 mepc 中
+ mcause (Machine Cause)
    + 當 trap 發生時，Hart 會設置此暫存器通知我們 trap 發生的原因
+ mtval (Machine Trap Value)
    + 保存了 exception 發生時的附加信息，如：
        + 訪問位址出吋時的位址信息
        + 執行非法指令時的指令本身
    + 對於其他異常，暫存器的值為 0
+ mstatus (Machine Status)
    + 用於跟蹤和控制 Hart 的當前操作狀態
        + 包括打開和關閉全局中斷
+ mscratch (Machine Scratch)
    + Machine mode 下專用的暫存器，我們可以自己定義其用法
        + 如使用此暫存器保存當前 Hart 上運行的 task 的 context 的位址
+ mie (Machine Interrupt Enable)
    + 用於進一步控制(打開和關閉) software interrupt、timer interrupt、external interrupt
+ mip (Machine Interrupt Pending)
    + 列出目前已發生等待處理的中斷

現在看不懂沒關係，後面會慢慢用到，接下來我們先看一下每個暫存器對應的 bit 的意義

### mtvec (Machine Trap-Vector Base-Address)

![image](https://hackmd.io/_uploads/ryHsRsquT.png)

這裡 WARL 的意思是「Write Any Values，Reads Legal Values」，也就是說這個地方可以隨便我們寫的，而讀出來的值都是合法的

+ Base
    + trap 入口函式的 base address，必須保證四字節對齊
    + 這個位址是我們可以自己填的
+ MODE
    + 進一步用於控制入口函式的位址配置方式
        + Direct：所有的 exception 和 interrupt 發生後，PC 都跳轉到 BASE 指定的位址處
        + Vectored：exception 處理方式同 Direct；但 interrupt 的入口地址以 array 方式排列
    + ![image](https://hackmd.io/_uploads/r10Uknc_p.png)

### mepc (Machine Exception Program Counter)

![image](https://hackmd.io/_uploads/Bk7ixh5d6.png)

+ 當 trap 發生時，PC 會被替換為 mtvec 設定的位址，同時 Hart 會將 mepc 設為目前指令或下一條指令的位址，當我們需要退出 trap 時可以呼叫特殊的 mret 指令，該指令會將 mepc 中的值還原為 PC 中（實現返回的效果）

+ 在處理 trap 的程式中我們可以修改 mepc 的值達到改變 mret 回傳位址的目的

### mcause (Machine Cause)

![image](https://hackmd.io/_uploads/BJ76bncu6.png)

這裡 WLRL 的意思是「Write/Read Only Legal Values」，表示我們在讀寫的時候需要確保它的值是合法的

+ 當 trap 發生時，hart 會設定該暫存器通知我們 trap 發生的原因。
+ 最高位元 Interrupt 為 1 時標識了目前 trap 為 interrupt，否則是  exception。
+ 剩餘的 Exception Code 用來標識具體的 interrupt 或 exception 的種類。
+ spec 內有附一張表格
    ![image](https://hackmd.io/_uploads/rywiz3cu6.png)
    
### mtval (Machine Trap Value)

用來輔助 mcause 用的暫存器

![image](https://hackmd.io/_uploads/S1rEmh9up.png)

+ 當 trap 發生時，除了透過 mcause 可以取得 exception 的種類 code 值外，hart 還提供了 mtval 來提供 exception 的其他資訊來輔助我們執行更進一步的操作。

+ 具體的輔助資訊由特定的硬體實作定義，RISC-V 規範沒有定義具體的值。 但規範定義了一些行為，譬如訪問地址出錯時的地址資訊、或執行非法指令時的指令本身等

### mstatus (Machine Status)

用來描述一些狀態信息的，分得很細

![image](https://hackmd.io/_uploads/HJ7YXh9dp.png)

WPRL 的意思是「Reserved Writes Preserve Values，Reads Ignore Values」，也就是說寫是保留值，忽略讀，簡單來說就是盡量不要去動它 

這邊老師挑了比較會用到的來講，分別是第 0~12 bit，其他部分涉及到記憶體訪問的權限、virtual memory 的控制等，暫時先不去管它

+ xIE（x=M/S/U）
    + 第 0~3 bit
    + 分別用於開啟（1）或關閉（0）M/S/U 模式下的全域中斷。 當 trap 發生時， hart 會自動將 xIE 設定為 0
+ xPIE（x=M/S/U）
    + 第 4~7 bit
    + 當 trap 發生時用於保存trap 發生之前的xIE值
+ xPP（x=M/S）
    + 第 8~12 bit 
    + 當 trap 發生時用於保存trap 發生之前的權限等級值
    + 注意沒有 UPP
        + 因為異常發生時通常都是要從低權限往高權限跳，或是維持原權限，因此不需要 UPP

## Trap 處理流程

Trap 處理的流程主要如下

1. Trap 初始化
    + 如設置入口位址
2. Trap 的上半部(Top Half)
    + 發生在硬體部份，不受我們控制
3. Trap 的下半部(Bottom Half)
    + 軟體部分，可由我們控制
4. 從 Trap 返回

那接下來就細看一下這四個部分

### Trap 初始化

首先我們要設置入口函數，也就是把 Bottom Half 的位址告訴 CPU，它才會跑到這個位址去執行我們的 Trap 下半部

那要怎麼告訴它呢? 只要設置 mtvec 這個暫存器就可以了：

```c
void trap_init()
{
    /*
     * set the trap-vector base-address for machine-mode
     */
    w_mtvec((reg_t)trap_vector);
}
```

這裡的 `trap_vector` 是我們寫好的一段邏輯，後面會提到

### top half 

雖然我們沒辦法對這部分做更動，但還是可以看一下硬體部分具體做了什麼

1. 把 mstatus 的 MIE 值複製到 MPIE 中，清除 mstatus 中的 MIE 標誌位，效果是中斷被禁止
    + 前面有提到 MIE 代表中斷的開或關
    + MIE 清除的話代表填 0，也就是說中斷目前是被關掉的狀態
2. 設定 mepc，同時 PC 被設定為 mtvec；需要注意的是，對於exception，mepc 指向導致異常的指令；對於 interrupt，它指向被中斷的指令的下一條指令的位置
    ![image](https://hackmd.io/_uploads/H16H6nq_p.png)
3. 根據 trap 的種類設定 mcause，並根據需要為 mtval 設定附加資訊
4. 將 trap 發生之前的權限模式保存在 mstatus 的 MPP 域中，再把 hart 權限模式改為 M（也就是說無論在任何 Level 下觸發 trap，hart 首先切換到 Machine 模式）

### Bottom half

這邊寫的是一段異常的處理函式，可以把過程總結為五步：

1. 保存 context
    + 利用 mscratch
2. 呼叫 C 語言的 trap handler
3. 從 trap handler 函式返回
    + mepc 的值可能需要調整
4. 恢復上下文
5. 利用 MRET 指令返回到 trap 前的狀態

下面這段是對應的函式 `trap_vector`：

```asm
# interrupts and exceptions while in machine mode come here.
.globl trap_vector
# the trap vector base address must always be aligned on a 4-byte boundary
.balign 4
trap_vector:
    # save context(registers).
    csrrw	t6, mscratch, t6	# swap t6 and mscratch
    reg_save t6

    # Save the actual t6 register, which we swapped into
    # mscratch
    mv	t5, t6		# t5 points to the context of current task
    csrr	t6, mscratch	# read t6 back from mscratch
    sw	t6, 120(t5)	# save t6 with t5 as base

    # Restore the context pointer into mscratch
    csrw	mscratch, t5

    # call the C trap handler in trap.c
    csrr	a0, mepc
    csrr	a1, mcause
    call	trap_handler

    # trap_handler will return the return address via a0.
    csrw	mepc, a0

    # restore context(registers).
    csrr	t6, mscratch
    reg_restore t6

    # return to whatever we were doing before trap.
    mret
```

而 `trap_handler` 是由 C 語言寫的邏輯：

```c
reg_t trap_handler(reg_t epc, reg_t cause)
{
    reg_t return_pc = epc;
    reg_t cause_code = cause & 0xfff;

    if (cause & 0x80000000) {
        /* Asynchronous trap - interrupt */
        switch (cause_code) {
        case 3:
            uart_puts("software interruption!\n");
            break;
        case 7:
            uart_puts("timer interruption!\n");
            break;
        case 11:
            uart_puts("external interruption!\n");
            break;
        default:
            uart_puts("unknown async exception!\n");
            break;
        }
    } else {
        /* Synchronous trap - exception */
        printf("Sync exceptions!, code = %d\n", cause_code);
        panic("OOPS! What can I do!");
        //return_pc += 4;
    }

    return return_pc;
}
```

函式中的 `cause` 是 mcause，因此最高位如果是 1，表示發生的是中斷，是 0 的話表示是異常

因此將其與 `0x80000000` 進行 and 操作，如果結果非 0 的話表示進來的是一個中斷，否則為一個異常

### 從 Trap 返回

從 trap 返回的話我們需要 MRET 這個指令

![image](https://hackmd.io/_uploads/B1X2JT5dp.png)

+ 針對不同權限等級下如何退出 trap 有各自的回傳指令 xRET（x = M/S/U)
    + 我們這裡用的是 MRET

+ 以在 M 模式下執行 mret 指令為例，會執行以下操作：
    + 將 Hart 的權限等級設為 `mstatus.MPP`
        + 也就是回復原本的權限
    + `mstatus.MPP` 設為 U（如果 hart 不支援U 則為M）
    + `mstatus.MIE` 設為 `mstatus.MPIE`
        + 也就是回復中斷的開關
    + `mstatus.MPIE` 設為 1
    + pc 設為 mepc
        + 也就是離開 trap

## Interrupt

### Interrupt 分類

中斷有分兩種：

+ 本地中斷(Local Interrupt)
    + software interrupt
    + timer interrupt
+ 全局中斷(Global Interrupt)
    + externel interrupt

所以我們也可以說有三種：software、timer 與 externel；每一種下面都會再分 User、Supervisor、Reserved 與 Machine：

![image](https://hackmd.io/_uploads/S1cpnA9Oa.png)

### mie 與 mip

前面講跟 Trap 有關的暫存器時還剩 mie 和 mip 兩個沒講，這兩個跟 Interrupt 有關，所以在這邊補一下

mie 用於控制 Interrupt 的開或關；前面有提到一個 mstatus，那個是控制全局的，一旦關閉，不管是哪種中斷都無法使用，而 mie 是可以設置要單獨關閉 software interrupt 這類的操作：

![image](https://hackmd.io/_uploads/BkXNCCqu6.png)

如果 mie 是用來寫的，那 mip 你可以認為就是拿來讀的，透過讀對應的 bit，我們可以得知當前發生了哪種中斷：

![image](https://hackmd.io/_uploads/S1iQ0C5da.png)

### PLIC

外部中斷代表的是外部設備所產生的中斷，通常一個 Hart 會有一根引腳來傳遞外部中斷的訊號，然而外部設備很多，那該怎麼辦呢?

![image](https://hackmd.io/_uploads/B1MnyJsuT.png)

此時我們就引入了一個叫做 PLIC 的設備，全名為 Platform-Level Interrupt Controller，類似一個 hub：

![image](https://hackmd.io/_uploads/ryPakkiuT.png)

左邊是很多不同的外設，它們全都會接到 PLIC 上；而 PLIC 到每一個 Hart 只會接一根引腳

所以它的功能也很明顯，因為 CPU 同一個時間肯定只能處理一個中斷，所以 PLIC 就會起到一個代理人的作用，根據中斷的類型或是優先級之類的條件來篩選要先執行哪個中斷

左邊的這些外設我們將其稱為中斷源：

![image](https://hackmd.io/_uploads/SkETlJsO6.png)

每一個外設我們會給他一個編號，標準內定義了 53 個中斷源，0 號預留不用，因此實際有效的中斷源為 1~53；前面我們有用到 UART，UART 的 id 為 10，下面是 QEMU 的實作：

```c
// https://github.com/qemu/qemu/blob/master/include/hw/riscv/virt.h
enum {
    UART0_IRQ = 10,
    RTC_IRQ = 11,
    VIRTIO_IRQ = 1, /* 1 to 8 */
    VIRTIO_COUNT = 8,
    PCIE_IRQ = 0x20, /* 32 to 35 */
    VIRT_PLATFORM_BUS_IRQ = 64, /* 64 to 95 */
};
```

PLIC 本身也是一個外部設備，和前面的 UART 一樣，所有的外設都是透過 MMIO 來訪問的，再 QEMU 中的定義如下：

```c
// https://github.com/qemu/qemu/blob/master/hw/riscv/virt.c
static const MemMapEntry virt_memmap[] = {
    [VIRT_DEBUG] =        {        0x0,         0x100 },
    [VIRT_MROM] =         {     0x1000,        0xf000 },
    [VIRT_TEST] =         {   0x100000,        0x1000 },
    [VIRT_RTC] =          {   0x101000,        0x1000 },
    [VIRT_CLINT] =        {  0x2000000,       0x10000 },
    [VIRT_ACLINT_SSWI] =  {  0x2F00000,        0x4000 },
    [VIRT_PCIE_PIO] =     {  0x3000000,       0x10000 },
    [VIRT_PLATFORM_BUS] = {  0x4000000,     0x2000000 },
    // 下面這行
    [VIRT_PLIC] =         {  0xc000000, VIRT_PLIC_SIZE(VIRT_CPUS_MAX * 2) },
    [VIRT_APLIC_M] =      {  0xc000000, APLIC_SIZE(VIRT_CPUS_MAX) },
    [VIRT_APLIC_S] =      {  0xd000000, APLIC_SIZE(VIRT_CPUS_MAX) },
    [VIRT_UART0] =        { 0x10000000,         0x100 },
    [VIRT_VIRTIO] =       { 0x10001000,        0x1000 },
    [VIRT_FW_CFG] =       { 0x10100000,          0x18 },
    [VIRT_FLASH] =        { 0x20000000,     0x4000000 },
    [VIRT_IMSIC_M] =      { 0x24000000, VIRT_IMSIC_MAX_SIZE },
    [VIRT_IMSIC_S] =      { 0x28000000, VIRT_IMSIC_MAX_SIZE },
    [VIRT_PCIE_ECAM] =    { 0x30000000,    0x10000000 },
    [VIRT_PCIE_MMIO] =    { 0x40000000,    0x40000000 },
    [VIRT_DRAM] =         { 0x80000000,           0x0 },
};
```

### Priority

至於 PLIC 有哪些 Programmable 的暫存器呢? 剛剛有提到 PLIC 的功能是根據中斷的優先級來篩選一個中斷進來，因此每個中斷源的優先級我們是可以單獨進行設定的：

+ 可以透過 Priority 這個暫存器來設定，他 MMIO 的記憶體映射位址為 `Base + (InterruptID*4)`
+ 設定的優先級的的值會是一個數字，介於 0~7 之間
    + 0 表示禁用此中斷源
    + 1 最低
    + 7 最高
+ 如果優先級相同，則根據中斷源的 ID 篩選，ID 較小的優先值較高

### Pending

下一個暫存器是 Pending，這個暫存器可以讓我們知道某一個中斷源是不是發生了

+ 每個 PLIC 有兩個 Pending
+ 一個 Pending 有 32 bit
    + 每一個 bit 代表一個中斷源
    + 0 表示沒有中斷發生，1 表示該中斷源發生了中斷
+ MMIO 的記憶體映射位址為 `BASE + 0x1000 + (InterruptID/32)`
+ Pending 暫存器可讀也可寫
    + 可以利用 claim 清 0
+ 第一個 Pending 的第 0 位永遠為 0

### Enable

我們也可以將中斷源設為關閉的，使用的是 Enable 暫存器

+ 一個 Hart 有兩個 Enable 暫存器
    + 用於針對該 Hart 啟動或關閉某路的中斷源
+ 一個 Enable 有 32 bit
    + 每一個 bit 代表一個中斷源
    + 1 表示 enable 此中斷源，反之則表示關閉了該中斷源
+ MMIO 的記憶體映射位址為 `BASE + 0x2000 + (hart*0x80)`

### Threshold

用來針對某個 Hart 設置中斷源優先級的閥值，如果優先級小於等於這個閥值的話，就算發生了中斷也會被扔掉

+ 每個 Hart 有一個 Threshold
+ 設為 0 表示接受所有中斷源上發生的中斷
+ 設為 7 表示丟棄所有中斷源上的中斷
+ MMIO 的記憶體映射位址為 `BASE + 0x200000 + (hart*0x1000)`

### Claim/Complete

+ Claim 和 Complete 是同一個暫存器，每個 Hart 有一個
+ 對這個暫存器進行讀操作稱為 Claim，即獲取當前發生的最高優先級的中斷源 ID
    + Claim 成功後會清除對應的 Pending 位
+ 對這個暫存器進行寫操作稱為 Complete，用來通知 PLIC 對該路中斷的處理已經結束

### PLIC 操作流程

這邊通過一張圖來了解一下設置這些暫存器到底起到了什麼作用

![image](https://hackmd.io/_uploads/HJye1ls_6.png)

左方的這個大正方形是一個 PLIC，上面接了兩個中斷源進來，右邊接了兩個 CPU 出去

這個是用來設置中斷源優先級的：

<center>

![image](https://hackmd.io/_uploads/ryvOJxjdp.png)

</center>
    
這個是用來設定是否要啟用此中斷源的：

<center>
    
![image](https://hackmd.io/_uploads/BJ651ejda.png)

</center>
    
這個用來設定中斷源的閥值：

<center>

![image](https://hackmd.io/_uploads/SkqRJxouT.png)

</center>

這個是 Pending，用來判斷中斷是不是發生了：

<center>
    
![image](https://hackmd.io/_uploads/ryszxxidT.png)
    
</center>

這個是 Claim/Complete：

<center>
    
![image](https://hackmd.io/_uploads/ryJBglodT.png)
    
</center>

### UART 的例子

前面我們用 UART 實現了一個字串的輸出，那這邊我們可以利用中斷與 UART 實現一個字串的輸入

原理是 UART 會接到我們的本機上，我們鍵盤敲一個字後會通知本機，本機再通過 UART 發送一個中斷給 PLIC，如此一來就可以讀一個字符了，然後在通過前面實作的字串輸出，輸出到我們螢幕上

首先要初始化 plic：

```c
void plic_init(void)
{
    int hart = r_tp();

    /* 
     * Set priority for UART0.
     *
     * Each PLIC interrupt source can be assigned a priority by writing 
     * to its 32-bit memory-mapped priority register.
     * The QEMU-virt (the same as FU540-C000) supports 7 levels of priority. 
     * A priority value of 0 is reserved to mean "never interrupt" and 
     * effectively disables the interrupt. 
     * Priority 1 is the lowest active priority, and priority 7 is the highest. 
     * Ties between global interrupts of the same priority are broken by 
     * the Interrupt ID; interrupts with the lowest ID have the highest 
     * effective priority.
     */
    *(uint32_t*)PLIC_PRIORITY(UART0_IRQ) = 1;

    /*
     * Enable UART0
     *
     * Each global interrupt can be enabled by setting the corresponding 
     * bit in the enables registers.
     */
    *(uint32_t*)PLIC_MENABLE(hart)= (1 << UART0_IRQ);

    /* 
     * Set priority threshold for UART0.
     *
     * PLIC will mask all interrupts of a priority less than or equal to threshold.
     * Maximum threshold is 7.
     * For example, a threshold value of zero permits all interrupts with
     * non-zero priority, whereas a value of 7 masks all interrupts.
     * Notice, the threshold is global for PLIC, not for each interrupt source.
     */
    *(uint32_t*)PLIC_MTHRESHOLD(hart) = 0;

    /* enable machine-mode external interrupts. */
    w_mie(r_mie() | MIE_MEIE);

    /* enable machine-mode global interrupts. */
    w_mstatus(r_mstatus() | MSTATUS_MIE);
}
```

注意寫 mie、mstatus 的方法是將原本的值先讀出來，然後再與我們要設置的 bit 做 bitwise or，這樣就可以保證不會改到原本的設定了

對於 trap 來說，`trap_handler` 內我們就在外部中斷的部份加上 handler：

```c
reg_t trap_handler(reg_t epc, reg_t cause)
{
    reg_t return_pc = epc;
    reg_t cause_code = cause & 0xfff;

    if (cause & 0x80000000) {
        /* Asynchronous trap - interrupt */
        switch (cause_code) {
        case 3:
            uart_puts("software interruption!\n");
            break;
        case 7:
            uart_puts("timer interruption!\n");
            break;
        case 11:
            uart_puts("external interruption!\n");
            external_interrupt_handler();
            break;
        default:
            uart_puts("unknown async exception!\n");
            break;
        }
    } else {
        /* Synchronous trap - exception */
        printf("Sync exceptions!, code = %d\n", cause_code);
        panic("OOPS! What can I do!");
        //return_pc += 4;
    }

    return return_pc;
}
```

`cause_code` 的數字含意見下表，前面也有貼過：

![image](https://hackmd.io/_uploads/rywiz3cu6.png)

`external_interrupt_handler` 的定義如下：

```c
void external_interrupt_handler()
{
    int irq = plic_claim();

    if (irq == UART0_IRQ){
        uart_isr();
    } 
    else if (irq) {
        printf("unexpected interrupt irq = %d\n", irq);
    }
	
    if (irq) {
        plic_complete(irq);
    }
}
```

首先通過 `plic_claim` 得到中斷源的 id，因為我們這邊處理的是 UART，因此就加上一個 UART 的處理函式，最後再加上一個 complete 函式通知處理完了

UART 的處理函式如下：

```c
/*
 * handle a uart interrupt, raised because input has arrived, called from trap.c.
 */
void uart_isr(void)
{
    while (1) {
        int c = uart_getc();
        if (c == -1) {
            break;
        }
        else {
            uart_putc((char)c);
            uart_putc('\n');
        }
    }
}
```

基本上就是讀進來然後輸出出去

然後前面有寫過 UART 的初始化函式，這邊要在最後面加上兩行，把 Interrupt 開起來：

```c
void uart_init()
{
    /* disable interrupts. */
    uart_write_reg(IER, 0x00);

    //......

    /*
     * enable receive interrupts.
     */
    uint8_t ier = uart_read_reg(IER);
    uart_write_reg(IER, ier | (1 << 0));
}
```

最後這兩行是將讀資料的 Interrupt 給打開

## timer interrupt

一個 Hart 會有三個 Interrupt 的引腳，剛剛講的屬於 External Interrupt，這邊來講 Timer Interrupt

![image](https://hackmd.io/_uploads/ryKuHM2da.png)

Timer Interrupt 屬於本地中斷，這代表他不是由外部設備發起的，而是由一個叫做 CLINT 的設備發出來的，其全名為 Core Local Interrupt，主要負責產生 software interrupt 與 timer interrupt

要訪問他一樣要透過定義好的暫存器，一樣是用 MMIO 的方式，QEMU 的定義如下：

```c
// https://github.com/qemu/qemu/blob/master/hw/riscv/virt.c
static const MemMapEntry virt_memmap[] = {
    [VIRT_DEBUG] =        {        0x0,         0x100 },
    [VIRT_MROM] =         {     0x1000,        0xf000 },
    [VIRT_TEST] =         {   0x100000,        0x1000 },
    [VIRT_RTC] =          {   0x101000,        0x1000 },
    // 下面這行
    [VIRT_CLINT] =        {  0x2000000,       0x10000 },
    [VIRT_ACLINT_SSWI] =  {  0x2F00000,        0x4000 },
    [VIRT_PCIE_PIO] =     {  0x3000000,       0x10000 },
    [VIRT_PLATFORM_BUS] = {  0x4000000,     0x2000000 },
    [VIRT_PLIC] =         {  0xc000000, VIRT_PLIC_SIZE(VIRT_CPUS_MAX * 2) },
    [VIRT_APLIC_M] =      {  0xc000000, APLIC_SIZE(VIRT_CPUS_MAX) },
    [VIRT_APLIC_S] =      {  0xd000000, APLIC_SIZE(VIRT_CPUS_MAX) },
    [VIRT_UART0] =        { 0x10000000,         0x100 },
    [VIRT_VIRTIO] =       { 0x10001000,        0x1000 },
    [VIRT_FW_CFG] =       { 0x10100000,          0x18 },
    [VIRT_FLASH] =        { 0x20000000,     0x4000000 },
    [VIRT_IMSIC_M] =      { 0x24000000, VIRT_IMSIC_MAX_SIZE },
    [VIRT_IMSIC_S] =      { 0x28000000, VIRT_IMSIC_MAX_SIZE },
    [VIRT_PCIE_ECAM] =    { 0x30000000,    0x10000000 },
    [VIRT_PCIE_MMIO] =    { 0x40000000,    0x40000000 },
    [VIRT_DRAM] =         { 0x80000000,           0x0 },
};
```

接下來看定義好的暫存器

### mtime

這是一個 real-time counter，實際上就是一個由石英振盪器觸發的時鐘，會按照一個固定的頻率遞增

+ 全局唯一
+ 64 bit
+ RESET 的時候，硬體會自動將 mtime 初始化為 0
+ MMIO 的位址為 `BASE + 0xbff8`

### mtimecmp

+ timer comapre register
+ 每個 Hart 一個
+ 64 bit
+ RESET 的時候硬體「不會」設定 mtimecmp 的值，需要我們手動設
+ MMIO 的位址為 `BASE + 0x4000 + (hart*8)`

下面是一個簡單的 mtimecmp 設定函式：

```c
// macro in platform.h
#define CLINT_MTIMECMP(hartid) (CLINT_BASE + 0x4000 + 8 * (hartid))

/* load timer interval(in ticks) for next timer interrupt.*/
void timer_load(int interval)
{
     /* each CPU has a separate source of timer interrupts. */
    int id = r_mhartid();
	
    *(uint64_t*)CLINT_MTIMECMP(id) = *(uint64_t*)CLINT_MTIME + interval;
}
```

`interval` 是想要間隔的數，例如想要間隔一秒鐘，那 `interval` 就是 1

### MSIP

其他還有一些這裡不會用到的，跟 software interrupt 相關的暫存器，這邊也一起紀錄一下

+ 每個 Hart 有一個
+ 32 bit
    + 實際上只用到了最低位
    + 高 31 位不能用
+ 最低位映射到 `mip.MSIP`
    + 當我們一寫 MSIP 的最低位時，會觸發軟中斷，`mip.MSIP` 也會自動設為 1
        + 需要將 MSIP 再寫入 0，對中斷進行回應，否則此軟中斷會一直發生
+ MMIO 的位址為 `BASE + (4*hart)`

### CLINT Time Interrupt

mtime 會按照一定的頻率不停地增加，而 CLINT 會去判斷 mtime，當其每增加一個值的時候，他會去確認 `mtime` 是否大於等於 `mtimecmp`，如果為真，那麼 CLINT 就會產生一個 timer interrupt

注意這個中斷只會產生一次，在 timer interrupt 發生後，Hart 會設置 `mip.MTIP`，因此如果想要產生一個週期性的中斷的話，需要在每次處理完中斷後，清除 `mip.MTIP` 並設定新的值進去

另外記得要 enable timer interrupt：

```c
// macro in riscv.h
#define MIE_MTIE (1 << 7)  // timer

/* enable machine-mode timer interrupts. */
w_mie(r_mie() | MIE_MTIE);
```

所以整個流程是

1. 硬體初始化 mtime 為 0
2. 我們將 mtimecmp 設定好，加上 interval
3. enable timer interrupt
4. 等待 timer interrupt
5. 觸發 timer interrupt
6. 執行 timer interrupt
7. 將 mtimecmp 加上 interval
8. 回到 4.

### 例子

OS 裡面的時間管理就是利用硬體的 time counter 完成的

+ 在 OS 中，一個時間單位為一個 tick
+ tick 的單位由硬體的 time counter 週期決定
    + 通常為 1~100 ms
+ tick 週期越小，OS 的精度越高
    + 但相對的開銷越大(因為 Interrupt 數量比較多)
+ OS 中通常會維護一個自己的 tick 值，紀錄系統啟動到現在發生的 tick 總數

## Preemtive Multitasking

雖然協作式的多任務實作比較簡單，但缺點也很明顯，需要使用者自己去放棄 CPU 的使用，進而衍生出不少的問題，因此已經被慢慢淘汰掉了

所以我們這邊就來實作搶占式的多任務，首先一樣會有兩個 Task A 和 B：

![image](https://hackmd.io/_uploads/HJI7rrhdT.png)

可以看見因為式搶占式的多任務，因此 Task 中不會有放棄 CPU 的這個指令

而這邊實作的方法是利用 timer，讓中斷週期性的發生，當 timer interrupt 發生時去進行 schedule

因此 trap 發生時要做的事為

1. 確認是否為 Timer Interrupt
2. 根據結果去執行對應 handler
2-1. 如果不是 Timer Interrupt，則按原本 Trap 的方式處理
2-2. 如果是 Timer Interrupt，呼叫 `switch_to`
    + `switch_to`
        + 將目前的 context 資訊存起來
        + 切換 context
        + 將下一個 context 資訊載入 CPU
    + 另外還要維護時鐘
3. mret

中斷發生的時候，按照前面的設計，會去走 `trap_vector` 這個入口，裡面會去呼叫 `trap_handler`

而 `trap_handler` 會利用 `cause_code` 來去看是哪一個中斷發生了，並呼叫對應的 handler

因此我們這邊要在 `timer_handler` 內部呼叫 `schedule`，而 `schedule` 內部會再呼叫 `switch_to` 這個函式

而相關的資料結構也要做一些調整，因為前面寫協作式多任務的時候不是通過 mret，而是通過 `return` 來實現的

為什麼可以這樣做呢? 因為當時當作一個正常的函式來實作，用了 `ra` 暫存器，但這邊我們應該要使用 `mepc` 才可以從中斷裡面返回

因此這邊每個 context 裡面也需要維護一個自己的 `mepc`，因此在 `struct context` 內新增一個 member 叫 `pc`：

```c
/* task management */
struct context {
    /* ignore x0 */
    reg_t ra;
    reg_t sp;
    // ...
    reg_t t6;
    // upon is trap frame

    // save the pc to run in next schedule cycle
    reg_t pc; // offset: 31*4 = 124
};
```

另外在 `trap_vector` 和 `switch_to` 內也要多加一些邏輯：

```asm
# interrupts and exceptions while in machine mode come here.
.globl trap_vector
# the trap vector base address must always be aligned on a 4-byte boundary
.balign 4
trap_vector:
    # save context(registers).
    csrrw	t6, mscratch, t6	# swap t6 and mscratch
    
    ......

    # save mepc to context of current task
    csrr	a0, mepc
    sw	a0, 124(t5)
    
    ......
    
    # call the C trap handler in trap.c
    csrr	a0, mepc
    csrr	a1, mcause
    call	trap_handler

    ......

    # return to whatever we were doing before trap.
    mret
```

這邊就只是多把 mepc 也保存到 context 內

而 `switch_to` 則是要多把 mepc 載入到 CPU，並且原本 save context 的邏輯因為在上面做過了，所以可以刪掉了：
```c
# void switch_to(struct context *next);
# a0: pointer to the context of the next task
.globl switch_to
.balign 4
switch_to:
    # switch mscratch to point to the context of the next task
    csrw	mscratch, a0
    
    # set mepc to the pc of the next task
    lw	a1, 124(a0)
    csrw	mepc, a1
    
    ......

    # Do actual context switching.
    # Notice this will enable global interrupt
    mret

.end
```

接下來用圖來演示一下步驟：

![image](https://hackmd.io/_uploads/BJOsdHhd6.png)

跟前面一樣，先初始化，並且假設第一個呼叫的任務為 A：

![image](https://hackmd.io/_uploads/S1U1orn_a.png)

之後就開始執行了，因此 PC 會跟著改變：

![image](https://hackmd.io/_uploads/ByQt3H3_6.png)

此時 timer interrupt 發生了，因此將 `i+2` 存入 `mepc`，並開始執行 trap 處理函式，首先要保存 context，因此將 `mepc` 存入 `pc`：

![image](https://hackmd.io/_uploads/rkeToBnd6.png)

接著切換 context：

![image](https://hackmd.io/_uploads/rk5CsHnd6.png)

然後載入 B 的 context：

![image](https://hackmd.io/_uploads/SkdmnB3dp.png)

最後執行 `mret` 返回，進到 Task B：

![image](https://hackmd.io/_uploads/rksBnrn_a.png)