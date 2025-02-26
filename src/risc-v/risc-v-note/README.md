---
title: 常用的 RISC-V 筆記
date: 2024-11-16
mathjax: true
tag: risc-v
category: risc-v
---

## 常用的 RISC-V 筆記

### 基本架構

一條典型的 RISC-V 語句由 3 部分組成：

> [ label: ] [ operation ] [ comment ]

三個都是可選的，因此可接受空行。 label 後面需接上冒號；operation 是比較重要的部分，真正的操作在這裡，裡面還可以分解；comment 是註釋。 

#### label(標籤)

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

#### operation

operation 總共有四種變化：

+ instruction (指令)
    直接對應二進位的機器指令字符串
+ pseudo-instruction (偽指令)
    為了提高寫程式的效率，可以用一條偽指令指示組譯器產生多條實際的 instruction
+ directive (指示/偽操作)
    通過類似 instruction 的形式(以 「.」 開頭)，通知組譯器如何控制程式碼的產生，不對應具體的指令，是由組譯器定義的
+ macro
    採用 .macro/.endm 自定義的 macro

### 指令的操作對象

指令的操作對象可以分兩大類：

+ 暫存器
    + RV32I 中共有 32 個通用暫存器，x0~x31，還有一些特權暫存器，其中 x0 是 0 暫存器，不可寫(但可以做為 `rd`)，讀出來的值永遠為 0
      > Register x0 can be used as the destination if the result is not required.
    + 在 RISC-V 中，Hart 在執行算術邏輯運算時操作的數據需要直接來自暫存器
+ 記憶體
    + Hart 可以執行在暫存器和記憶體之間的數據讀寫操作
    + 讀寫操作使用 Byte 為基本單位尋址
    + RV32 可以存取最多 $2^{32}$ 個 Byte 的記憶體空間

### 指令編碼格式

<center>

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/risc-v/risc-v-note/image/1.png?raw=true">

</center><br>

指令最後會被翻譯為機器指令，裡面的 32 bits 都有對應的意思，以 32 bits 對齊，每個 32 bits 會照上面的圖被劃分為不同的區域(field)

最終的指令類型是由 funct3/funct7 和 opcode 一起決定的，題外話，funct3 中的 "3" 代表佔了 3 個 bit，funct7 同理

對於 opcode 的部分有另一張表規定了其內容意義：

<center>

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/risc-v/risc-v-note/image/2.png?raw=true">

</center><br>

opcode 的前兩位永遠為 11，而第 2~4 位是一組的，5~6 位是一組的，我們用一個例子來學習這個表格是怎麼看得：

> 0000000 rs2 rs1 000 rd 0110011 | ADD

這是 ADD 這個指令的機器碼範例，依照最前面的表格我們知道後面的 `0110011` 是 opcode，可以看見前兩位(最右邊)為 `11`

我們先看第 5~6 位，這裡是 `01`，因此我們去上表的左邊縱排找 `01`，之後看有哪些可能，有 STORE、STORE-FP、custom-1、AMO、OP、LUI、OP-32 這些

我們再依照第 2~4 位來確認位置，這裡是 `100`，對到表格上就是 `OP`，也就是說 ADD 屬於 `OP` 類型的指令，也就是基本操作

RISC-V 標準中為 little endian，假設在記憶體中的值為 `b3 05 95 00`，則需要先將其倒反過來為：`00 95 05 b3`，寫為二進制的話為 `00000000-10010101-00000101-10110011`，到標準中查表可知此指令為 `add x11, x10, x9`

<center>

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/risc-v/risc-v-note/image/3.png?raw=true">

</center><br>

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


### 算術運算指令(Arithmetic Instruction)

#### ADD

功能：將兩暫存器的值相加
語法：`ADD RD, RS1, RS2`
> 例：add x5, x6, x7 為 x5 = x6 + x7 

格式：R-type

<center>

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/risc-v/risc-v-note/image/4.png?raw=true">

</center><br>

對應意義：
+ opcode(7)：0110011 (OP)
+ funct3 為 000，funct7 為 0000000
+ rs1(5)：第一個 operand (source register 1)
+ rs2(5)：第二個 operand (source register 2)
+ rd(5)：destination register，用於存放加出來的結果

#### SUB

功能：將兩暫存器的值相減
語法：`SUB RD, RS1, RS2`
> 例：sub x5, x6, x7 為 x5 = x6 - x7 

格式同為 R-type

#### ADDI (ADD Immediate)

功能：將暫存器中的值與一常數相加
語法： `ADDI RD, RS1, IMM`
> 例：addi x5, x6, 1  為 x5 = x6 + 1

格式：I-type

<center>

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/risc-v/risc-v-note/image/5.png?raw=true">

</center><br>

對應意義：

+ opcode (7)：0b0010011 (OP-IMM)
+ funct3 (3)：和 opcode 一起決定最終指令
+ rs1 (5)：第一個 opecrand (source register 1)
+ rd (5)：destination register，用於存放加出來的結果
+ imm (12)：immediate，常數，要注意只有 12 bits，所以範圍是有限的

在運算前 `imm` 會被 sign-extension 為一個 32 位的數，可以表達的範圍為 $-2^{11} ~ 2^{11}$，也就是 $[-2048, 2047)$

#### LUI (Load Upper Immediate)

為了要加超過 12 bits 的常數，risc-v 引入了一個新的指令來「載入一個 32 bits 的常數」，作法是把一個 32 bits 的數切為高 20 位與低 12 位，之後先將高 20 位放到一個暫存器內，在利用 `ADDI` 將低 12 位的部分加上去

用來構造高 20 位的指令就是 `LUI`

功能：構造一個 32 bits 的常數，此常數高 20 位為 `imm` 的內容，低 12 位為 0，這個常數會作為結果存在 RD 中
語法：`LUI RD, IMM`
> 例：lui x5, 0x12345 為 x5 = 0x12345 << 12

格式：U-type

<center>

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/risc-v/risc-v-note/image/6.png?raw=true">

</center><br>

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

#### AUIPC

我們在構造一個位址的流程其實和建構一個普通的數值沒有太大的區別，可以用 `LUI` 和 `ADDI` 來做，但這樣建構出的會是一個直接指定好的常數，但在構造位址的時候我們還會希望有相對位址，所以就需要 `AUIPC`，名字中的 `PC` 指的是 program counter

功能：構造一個 32 bits 的常數，高 20 位為 `imm`，低 12 位為 0，但會將此常數與 `PC` 值相加，結果存於 RD
語法：`AUIPC RD, IMM`
> 例：auipc x5, 0x12345 為 x5 = 0x12345 << 12 + PC


#### 相關的 pseudo-instruction

##### NEG

功能：對 RS 取負號，將結果存在 RD 中
語法：`NEG RD, RS`
等價指令：`SUB RD, x0, RS`
> 例：neg x5, x6

##### MV

功能：將 RS 中的值複製到 RD 中
語法：`MV RD, RS`
等價指令：`ADDI RD, RS, 0`
> 例：mv x5, x6

##### LI (Load Immediate)

因為用 `LUI` 在載入一個數時還要考慮提前借位的問題太麻煩了，所以就有了 `LI`

功能：載入一個常數，組譯器會根據 imm 的情況自動判斷要不要借位
語法：`LI RD, IMM`
> 例：li x5, 0x12345678 為 x5 = 0x12345678

##### LA (Load Address)

在寫 code 的時候給出需要載入的 label，組譯器會根據實際情況利用 `AUIPC` 和其他指令自動生成正確的指令來載入記憶體位址，常用於載入一個函式或變數的位址

功能：載入一個地址
語法：`LA RD, LABEL`
> 例：la x5, foo

##### NOP (空指令)

功能：不做任何事
語法：`NOP`
等價指令：`ADDI x0, 0, 0`
> 例：nop

### 邏輯運算指令 (Logical Instructions)

#### AND

功能：`RD = RS1 & RS2`
語法：`AND RD, RS1, RS2`
格式：R-type
> 例：and x5, x6, x7

#### OR

功能：`RD = RS1 | RS2`
語法：`OR RD, RS1, RS2`
格式：R-type
> 例：or x5, x6, x7

#### XOR

功能：`RD = RS1 ^ RS2`
語法：`XOR RD, RS1, RS2`
格式：R-type
> 例：xor x5, x6, x7

#### ANDI

功能：`RD = RS1 & IMM`
語法：`ANDI RD, RS1, IMM`
格式：I-type
> 例：`andi x5, x6, 20`

#### ORI

功能：`RD = RS1 | IMM`
語法：`ORI RD, RS1, IMM`
格式：I-type
> 例：`ori x5, x6, 20`

#### XORI

功能：`RD = RS1 ^ IMM`
語法：`XORI RD, RS1, IMM`
格式：I-type
> 例：`xori x5, x6, 20`

#### 相關的 pseudo-instruction

##### NOT

功能：對 RS 做 Bitwise Complement，將結果存在 RD 中
語法：`NOT RD, RS`
等價指令：`XORI RD, RS, -1`
> 例：not x5, x6

### 移位運算指令 (Shifting Instructions)

#### SLL (邏輯左移)

補 0

功能：`RD = RS1 << RS2`
語法：`SLL RD, RS1, RS2`
格式：R-type
> 例：sll x5, x6, x7

#### SRL (邏輯右移)

補 0

功能：`RD = RS1 >> RS2`
語法：`SRL RD, RS1, RS2`
格式：R-type
> 例：srl x5, x6, x7

#### SLLI (邏輯左移常數)

補 0

功能：`RD = RS1 << IMM`
語法：`SLLI RD, RS1, IMM`
格式：I-type
> 例：slli x5, x6, 3

#### SRLI (邏輯右移常數)

補 0

功能：`RD = RS1 >> IMM`
語法：`SRLI RD, RS1, IMM`
格式：I-type
> 例：srli x5, x6, 3

#### SRA (算術右移)

按符號位補足

功能：`RD = RS1 >> RS2`
語法：`SRA RD, RS1, RS2`
格式：R-type
> 例：sra x5, x6, x7

#### SRAI (算術右移常數)

按符號位補足

功能：`RD = RS1 >> IMM`
語法：`SRAI RD, RS1, IMM`
格式：I-type
> 例：srai x5, x6, 3

### 記憶體讀寫指令 (Load and Store Instructions)

#### LB

`IMM` 範圍為 $[-2048, 2047]$，資料在保存到 RD 前會執行 sign-extension

功能：Load Byte，從記憶體中讀一個 8 bits 的數據到 RD 中，記憶體位址為 `RS1 + IMM`
語法：`LB RD, IMM(RS1)`
格式：I-type
> 例：lb x5, 40(x6)

#### LBU

`IMM` 範圍為 $[-2048, 2047]$，資料在保存到 RD 前會執行 zero-extension

功能：Load Byte Unsigned，從記憶體中讀一個 8 bits 的數據到 RD 中，記憶體位址為 `RS1 + IMM`
語法：`LBU RD, IMM(RS1)`
格式：I-type
> 例：lbu x5, 40(x6)

#### LH

`IMM` 範圍為 $[-2048, 2047]$，資料在保存到 RD 前會執行 sign-extension

功能：Load Halfword，從記憶體中讀一個 16 bits 的數據到 RD 中，記憶體位址為 `RS1 + IMM`
語法：`LH RD, IMM(RS1)`
格式：I-type
> 例：lh x5, 40(x6)

#### LHU

`IMM` 範圍為 $[-2048, 2047]$，資料在保存到 RD 前會執行 zero-extension

功能：Load Halfword Unsigned，從記憶體中讀一個 16 bits 的數據到 RD 中，記憶體位址為 `RS1 + IMM`
語法：`LHU RD, IMM(RS1)`
格式：I-type
> 例：lhu x5, 40(x6)

#### LW

`IMM` 範圍為 $[-2048, 2047]$

功能：Load Word，從記憶體中讀一個 32 bits 的數據到 RD 中，記憶體位址為 `RS1 + IMM`
語法：`LW RD, IMM(RS1)`
格式：I-type
> 例：lw x5, 40(x6)

#### SB

`IMM` 範圍為 $[-2048, 2047]$

功能：Store Byte，將 RS2 中低 8 bits 的資料寫到記憶體中，記憶體位址為 `RS1 + IMM`
語法：`SB RS2, IMM(RS1)`
格式：S-type
> 例：sb x5, 40(x6)

#### SH

`IMM` 範圍為 $[-2048, 2047]$

功能：Store Halfword，將 RS2 中低 16 bits 的資料寫到記憶體中，記憶體位址為 `RS1 + IMM`
語法：`SH RS2, IMM(RS1)`
格式：S-type
> 例：sh x5, 40(x6)

#### SW

`IMM` 範圍為 $[-2048, 2047]$

功能：Store Word，將 RS2 中低 32 bits 的資料寫到記憶體中，記憶體位址為 `RS1 + IMM`
語法：`SW RS2, IMM(RS1)`
格式：S-type
> 例：sw x5, 40(x6)

### 分支指令 (Conditional Branch Instructions)

#### BEQ

跳躍的目標地址計算方法為：先將 IMM * 2，符號擴展後和 PC 值相加得到最終的目標位址，所以跳躍的範圍是以 PC 為基準，加減 4KB 左右 ($[-4096, 4094]$)

實際上在寫的時候不會直接寫常數，而是會寫標籤帶體，交由 Linker 決定最終的 `IMM` 值

功能：Branch if EQual，比較 RS1 和 RS2 的值，若相等，執行路徑跳躍到新的地址
語法：`BEQ RS1, RS2, IMM`
格式：B-type
> 例：beq x5, x6, 100

#### BNE

跳躍的目標地址計算方法為：先將 IMM * 2，符號擴展後和 PC 值相加得到最終的目標位址，所以跳躍的範圍是以 PC 為基準，加減 4KB 左右 ($[-4096, 4094]$)

實際上在寫的時候不會直接寫常數，而是會寫標籤帶體，交由 Linker 決定最終的 `IMM` 值

功能：Branch if Not Equal，比較 RS1 和 RS2 的值，若不相等，則執行路徑跳躍到新的地址
語法：`BNE RS1, RS2, IMM`
格式：B-type
> 例：bne x5, x6, 100

#### BLT

跳躍的目標地址計算方法為：先將 IMM * 2，符號擴展後和 PC 值相加得到最終的目標位址，所以跳躍的範圍是以 PC 為基準，加減 4KB 左右 ($[-4096, 4094]$)

實際上在寫的時候不會直接寫常數，而是會寫標籤帶體，交由 Linker 決定最終的 `IMM` 值

功能：Branch if Less Than，依照「有號」方式比較 RS1 和 RS2 的值，若 RS1 < RS2，則執行路徑跳躍到新的地址
語法：`BLT RS1, RS2, IMM`
格式：B-type
> 例：blt x5, x6, 100

#### BLTU

跳躍的目標地址計算方法為：先將 IMM * 2，符號擴展後和 PC 值相加得到最終的目標位址，所以跳躍的範圍是以 PC 為基準，加減 4KB 左右 ($[-4096, 4094]$)

實際上在寫的時候不會直接寫常數，而是會寫標籤帶體，交由 Linker 決定最終的 `IMM` 值

功能：Branch if Less Than (Unsigned)，依照「無號」方式比較 RS1 和 RS2 的值，若 RS1 < RS2，則執行路徑跳躍到新的地址
語法：`BLTU RS1, RS2, IMM`
格式：B-type
> 例：bltu x5, x6, 100

#### BGE

跳躍的目標地址計算方法為：先將 IMM * 2，符號擴展後和 PC 值相加得到最終的目標位址，所以跳躍的範圍是以 PC 為基準，加減 4KB 左右 ($[-4096, 4094]$)

實際上在寫的時候不會直接寫常數，而是會寫標籤帶體，交由 Linker 決定最終的 `IMM` 值

功能：Branch if Greater than or Equal，依照「有號」方式比較 RS1 和 RS2 的值，若 RS1 >= RS2，則執行路徑跳躍到新的地址
語法：`BGE RS1, RS2, IMM`
格式：B-type
> 例：bge x5, x6, 100

#### BGEU

跳躍的目標地址計算方法為：先將 IMM * 2，符號擴展後和 PC 值相加得到最終的目標位址，所以跳躍的範圍是以 PC 為基準，加減 4KB 左右 ($[-4096, 4094]$)

實際上在寫的時候不會直接寫常數，而是會寫標籤帶體，交由 Linker 決定最終的 `IMM` 值

功能：Branch if Greator than or Equal (Unsigned)，依照「無號」方式比較 RS1 和 RS2 的值，若 RS1 >= RS2，則執行路徑跳躍到新的地址
語法：`BGEU RS1, RS2, IMM`
格式：B-type
> 例：bgeu x5, x6, 100

#### 相關的 pseudo-instruction

#### BLE

功能：Branch if Less and Equal，有號方式比較，如果 RS <= RT，跳躍到 OFFSET
語法：`BLE RS, RT, OFFSET`
等價指令：`BGE RT, RS, OFFSET`

#### BLEU

功能：Branch if Less or Equal Unsigned，無號方式比較，如果 RS <= RT，跳躍到 OFFSET
語法：`BLEU RS, RT, OFFSET`
等價指令：`BGEU RT, RS, OFFSET`

#### BGT

功能：Branch if Greater Than，有號方式比較，如果 RS > RT，跳躍到 OFFSET
語法：`BGT RS, RT, OFFSET`
等價指令：`BLT RT, RS, OFFSET`

#### BGTU

功能：Branch if Greator Than Unsigned，無號方式比較，如果 RS > RT，跳躍到 OFFSET
語法：`BGTU RS, RT, OFFSET`
等價指令：`BLTU RT, RS, OFFSET`

#### BEQZ

功能：Branch if Equal Zero，如果 RS == 0，跳躍到 OFFSET
語法：`BEQZ RS, OFFSET`
等價指令：`BEQ RS, x0, OFFSET`

#### BNEZ

功能：Branch if Not Equal Zero，如果 RS != 0，跳躍到 OFFSET
語法：`BNEZ RS, OFFSET`
等價指令：`BNE RS, x0, OFFSET`

#### BLTZ

功能：Branch if Less Than Zero，如果 RS < 0，跳躍到 OFFSET
語法：`BLT RS, x0, OFFSET`
等價指令：`BLT RS, x0, OFFSET`

#### BLEZ

功能：Branch if Less or Equal Than Zero，如果 RS <= 0，跳躍到 OFFSET
語法：`BLEZ RS, OFFSET`
等價指令：`BGE x0, RS, OFFSET`

#### BGTZ

功能：Branch if Greater Than Zero，如果 RS > 0，跳躍到 OFFSET
語法：`BGTZ RS, OFFSET`
等價指令：`BLT x0, RS, OFFSET`

#### BGEZ

功能：Branch if Greater or Equal Zero，如果 RS >= 0，跳躍到 OFFSET
語法：`BGEZ RS, OFFSET`
等價指令：`BGE RS, x0, OFFSET`

### 無條件跳躍 (Unconditional Jump Instructions)

#### JAL (Jump And Link)

功能：跳躍到目標位址，用於呼叫函式 
語法：`JAL RD, LABEL`
格式：J-type
> 例：jal x1, label

<center>

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/risc-v/risc-v-note/image/7.png?raw=true">

</center><br>

調用函式時地址的計算方法為先對 20 bits 寬的 `IMM` 乘以 2，然後進行 sign-extension，最後與 PC 相加，因此跳躍的範圍是以 PC 為基準，上下加減 1 MB

JAL 指令的下一條指令的地址會寫入 RD，保存為返回位址，實際在寫時會用 label 給出跳躍的目標，具體 `IMM` 值由組譯器和 linker 負責生成

#### JALR (Jump And Link Register)

功能：跳躍到目標位址，用於呼叫函式
語法：`JALR RD, IMM (RS1)`
格式：I-type
> 例：jalr x0, 0(x5)

<center>

<img src = "https://github.com/Mes0903/MesBlog/blob/vuepress-theme-hope/src/risc-v/risc-v-note/image/8.png?raw=true">

</center><br>

調用函式時地址的計算方法為先對 12 bits 寬的 `IMM` 進行 sign-extension，然後將其與 RS1 的值相加，得到最終的結果後將其最低位設為 0 (用以確保對齊)，因此跳躍的範圍是以 RS1 為基準，上下加減 2KB