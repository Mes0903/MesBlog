---
title: （WIP）機率筆記
date: 2025-10-21
tag: Probability
category: math
---

# 機率筆記

## 集合（Sets）

- 集合（Set）內含一群物件，而這些物件稱作集合的元素（elements）
  - 若 $x$ 是集合 $S$ 的元素，記作 $x \in S$
  - 否則記作 $x \notin S$
- 沒有任何元素的集合稱為空集合（empty set），記作 $\varnothing$
- 集合的表示方式：
  - 可數有限（countably finite）：$\{1, 2, 3, 4, 5, 6\}$
  - 可數無限（countably infinite）：$\{0, 2, -2, 4, -4, \dots\}$
  - 以條件定義（with a certain property）：
    - $\{k \mid k/2 \text{ is integer}\}$（可數無限）
    - $\{x \mid 0 \le x \le 1\}$（不可數）
- 若集合 $S$ 的每一個元素同時也是集合 $T$ 的元素，則稱 $S$ 是 $T$ 的子集合（subset）
  - 記作 $S \subset T$ 或 $T \supset S$
  - 空集合 $\varnothing$ 是否是任何集合的子集合？
    - 給定任意一個集合 $A$
    - 根據定義，除非在 $\varnothing$ 中存在某個不屬於 $A$ 的元素，否則 $\varnothing$ 是 $A$ 的子集合
      - 若 $\varnothing$ 不是 $A$ 的子集合，則代表 $\varnothing$ 中存在某元素不在 $A$ 中
    - 然而 $\varnothing$ 沒有任何元素，這會導致矛盾。 所以 $\varnothing$ 必定是 $A$ 的子集合
- 若 $T \subset S$ 且 $S \subset T$，則兩者相等（equal）
  - 記作 $T = S$
- 全集（universal set）記作 $\Omega$，它包含在特定語境中所有感興趣的物件
  - 一旦在某語境中指定了全集 $\Omega$，後面做操作時我們只會使用 $\Omega$ 子集合的

## Set Operations

- 補集（Complement）
  - 集合 $S$ 對於全集 $\Omega$ 的補集是 $\{x \in \Omega \mid x \notin S\}$，也就是所有不屬於 $S$ 的元素所組成的集合，記作 $S^c$
  - 全集的補集為 $\Omega^c = \varnothing$
- 聯集（Union）
  - 兩個集合 $S$ 與 $T$ 的聯集是所有屬於 $S$ 或 $T$ 的元素所構成的集合，記作 $S \cup T$
    $$S \cup T = \{x \mid x \in S \text{ or } x \in T\}$$
- 交集（Intersection）
  - 兩個集合 $S$ 與 $T$ 的交集是同時屬於 $S$ 與 $T$ 的所有元素所組成的集合，記作 $S \cap T$
  $$S \cap T = \{x \mid x \in S \text{ and } x \in T\}$$
- 若干（甚至無限多個）集合的聯集或交集可表示為：
  $$
  \bigcup_{n=1}^{\infty} S_n = S_1 \cup S_2 \cup \cdots = \{x \mid x \in S_n \text{ for some } n\}
  $$
  $$
  \bigcap_{n=1}^{\infty} S_n = S_1 \cap S_2 \cap \cdots = \{x \mid x \in S_n \text{ for all } n\}
  $$
- 互斥（Disjoint）
  - 如果兩個集合的交集為空，即 $S \cap T = \varnothing$，則稱它們是互斥的
- 劃分（Partition）
  - 一組集合若彼此互斥，且它們的聯集為集合 $S$，則稱該組集合為 $S$ 的劃分
  - 也就是說這組集合加起來會變成 $S$
- 若 $x$ 與 $y$ 是兩個物件，則以 $(x, y)$ 表示它們的有序對（order pair）
- 實數（scalar）的集合記作 $\mathbb{R}$
- 實數對（或三元組，triplets）所形成的集合，即二維平面（或三維空間），分別記作 $\mathbb{R}^2$（或 $\mathbb{R}^3$）

![](image/Figure1.1.png)

- 以下等式是根據集合及其運算定義所得到的基本結果：
  - 交換律
    $$S \cup T = T \cup S$$
  - 結合律：
    $$S \cup (T \cup U) = (S \cup T) \cup U$$
  - 分配律：
    $$S \cap (T \cup U) = (S \cap T) \cup (S \cap U)$$
    $$S \cup (T \cap U) = (S \cup T) \cap (S \cup U)$$
  - 此外，還有以下性質：
    $$(S^c)^c = S$$
    $$S \cup \Omega = \Omega$$
    $$S \cap S^c = \varnothing$$
    $$S \cap \Omega = S$$

還有兩個來自 De Morgan’s law（迪摩根律）的性質：

$$(\bigcup_n S_n)^c = \bigcap_n S_n^c \quad \Longrightarrow \quad (\bigcap_n S_n)^c = \bigcup_n S_n^c$$

德摩根律推導：

已知

$$(\bigcup_n S_n)^c = \bigcap_n S_n^c$$

要證明

$$(\bigcap_n S_n)^c = \bigcup_n S_n^c$$

因此有

$$(\bigcup_n S_n^c)^c = \bigcap_n S_n \quad (\text{將 } S_n \text{ 以 } S_n^c \text{ 代換，且 } (S_n^c)^c = S_n)$$

對上述等式的兩邊取補集，得到

$$\bigcup_n S_n^c = (\bigcap_n S_n)^c$$


## 機率模型

- 機率模型（probabilistic model）是對不確定情況的數學描述
  - 它必須符合接下來將要介紹的基本框架
- 機率模型的組成要素：
  - 樣本空間（sample space）：  
    所有可能實驗結果所構成的集合
  - 機率律（probability law）：  
    對於一個可能結果的集合 $A$（也稱為一個事件 event），給定一個非負數 $P(A)$（稱為事件 $A$ 的機率，probability of $A$），用以表達我們對 $A$ 中所有結果發生的整體「可能性」的認知或信念

![](image/Figure1.2.png)

- 每一個機率模型都包含一個基礎過程，稱作實驗（experiment）：
  - 實驗會在多個可能結果之中，產生且僅產生一個結果
  - 所有可能結果的集合稱為該實驗的樣本空間（sample space），記作 $\Omega$
  - 樣本空間的任一子集合（即一組可能結果）稱為一個事件（event）
- 需要特別注意：
  - 在機率模型的建立中，只存在一個實驗
  - 例如，擲三次硬幣視為一次實驗，而非三次獨立的實驗
- 一個實驗的樣本空間可以包含有限或無限多個可能的結果
- 實驗的例子
  - 擲一次硬幣（有限結果）
  - 擲三次兩顆六面骰（有限結果）
  - 無限次擲硬幣的序列（無限結果）
  - 向正方形目標射飛鏢（無限結果）

---

- 樣本空間的性質：
  - 樣本空間的各元素必須互斥（mutually exclusive）：
    - 當實驗進行時，只會產生唯一的一個結果
  - 樣本空間必須是完備（collectively exhaustive）的：
    - 所有可能的結果都應包含在內
  - 樣本空間應具有適當的細緻度（right granularity）：
    - 必須有足夠的細節，以區分模型中所有有意義的結果，同時避免不相關的細節
- **Example 1.1** 考慮兩種不同的遊戲（用來獲得金錢），這兩種遊戲都包含十次連續的擲幣：
  - **Game 1：** 每當出現正面（Head）時，我們獲得 $1
  - **Game 2：** 我們在每次擲幣中都能獲得 $1，直到第一次出現正面為止。 接著，我們在每次擲幣中獲得 $2，直到第二次出現正面為止。 一般而言，每當出現一次正面時，金額就會加倍
  - **Game 1** 包含 11 種可能的結果 $(0,1,\dots,10)$（代表獲得的金額）  
    - 只有正面出現的總次數重要
  - **Game 2** 包含 ?? 種可能的結果（代表獲得的金額）  
    - 需要更細的描述  
    - 例如，每一個結果對應到一個可能的十次擲幣序列
      - 例如 $1, 1, 1, 2, 2, 2, 4, 4, 4, 8$
    - 需要在意正反面的順序
- **另一個針對 Game 2 的例子：** 三次連續擲幣
  - 一個給定的物理情境可以用不同的方式建模，這取決於我們關注的問題類型
  
  <span class = "center-column">

  | Toss Sequence | Result |
  |---------------|---------|
  | T T T | (1 1 1) |
  | T T H | (1 1 2) |
  | T H T | (1 1 2) |
  | T H H | (1 2 2) |
  | H T T | (1 2 2) |
  | H T H | (1 2 4) |
  | H H T | (1 2 4) |
  | H H H | (1 2 4) |

  </span>

## Sequential Probabilistic Models (序列機率模型)

- 許多實驗本質上具有序列性的特徵：
  - 擲硬幣三次
  - 連續五天觀察股票價值
  - 通訊接收端連續接收八個數位信號
- 它們可以用 tree-based sequential description（基於樹狀的序列描述）來表示

![](image/Figure1.3.png)

圖中顯示：
- 左側為兩次擲骰的樣本空間 (Sample Space: Pair of Rolls)
- 右側為樹狀描述 (Sequential Tree Description)，從 root 開始，依序展開各個可能結果 $(1,1), (1,2), (1,3), (1,4)$ 等

## Probability Laws (機率法則)

- 當確定一個實驗的樣本空間（Sample Space）後，我們便可以建立一個 **probability law（機率法則）**
  - 用來指定每一個結果（或任意一組結果，即事件）的可能性（likelihood）
  - 更精確地說，我們對每個事件 $A$ 指定一個數值 $P(A)$，稱為事件 $A$ 的機率（probability of A），並且此機率需滿足接下來描述的三個機率公理（three probability axioms）

### Three Probability Axioms (三個機率公理)

1. **Nonnegativity**  
   對於任何事件 $A$，  
   $$
   P(A) > 0
   $$
2. **Additivity**  
   若事件 $A$ 與 $B$ 是互斥的（disjoint events），則它們聯集的機率滿足：
   $$
   P(A \cup B) = P(A) + P(B)
   $$

   更一般地說，若樣本空間包含無限多個元素，且 $A_1, A_2, \dots$ 是一序列的互斥事件，則：
   $$
   P(A_1 \cup A_2 \cup \dots) = P(A_1) + P(A_2) + \dots
   $$

3. **Normalization**  
   整個樣本空間 $\Omega$ 的機率等於 1，即：
   $$
   P(\Omega) = 1
   $$

## Probability Laws for Discrete Models (離散模型的機率法則)

- **Discrete Probability Law（離散機率法則）**  
  若樣本空間由有限個可能結果組成，則機率法則由這些單一事件的機率所決定。 
  對於任意事件 $\{s_1, s_2, \dots, s_n\}$，其機率為各元素機率的總和：

  $$
  P(\{s_1, s_2, \dots, s_n\}) = P(\{s_1\}) + P(\{s_2\}) + \dots + P(\{s_n\})
  = P(s_1) + P(s_2) + \dots + P(s_n)
  $$
- **Discrete Uniform Probability Law（離散均勻機率法則）**  
  若樣本空間包含 $n$ 個等可能的結果（即每個單一事件的機率皆相同），則任意事件 $A$ 的機率為：

  $$
  P(A) = \frac{\text{number of element of } A}{n}
  $$

## An Example Probabilistic Model with a Discrete but Infinite Sample Space  

- 四面骰的範例：

  ![](image/Figure1.4.png)

- 具有離散但無限樣本空間的機率模型範例：

  樣本空間：$\{ n = 1, 2, 3, 4, \dots \}$

  已知：
  $$
  P(n) = \frac{1}{2^n}
  $$

  驗證總和是否為 1：

  $$
  \sum_{n=1}^{\infty} P(n)
  = \frac{1}{2} + \frac{1}{4} + \frac{1}{8} + \frac{1}{16} + \dots
  = \frac{1}{2} \sum_{n=0}^{\infty} \frac{1}{2^n}
  = \frac{1}{2} \cdot \frac{1}{1 - \frac{1}{2}}
  = 1
  $$

  接著計算奇數事件的機率：

  $$
  P(n \text{ is odd}) = \frac{1}{2} + \frac{1}{8} + \frac{1}{32} + \dots
  = \frac{1}{2} \cdot \left( 1 + \frac{1}{4} + \frac{1}{16} + \dots \right)
  = \frac{1}{2} \cdot \frac{1}{1 - \frac{1}{4}}
  = \frac{2}{3}
  $$

  因此，

  $$
  P(n \text{ is even}) = \frac{1}{3}
  $$

## Continuous Models (連續模型)

- **Probabilistic models with continuous sample spaces（具有連續樣本空間的機率模型）**
  - 對於單一元素事件，指定其機率是不合適的
  - 對於樣本空間中的任意區間（一維）或面積（二维）指定機率才有意義

- Example 1.5：Romeo 與 Juliet 約好在某個時間見面，兩人到達會合地點的延遲時間皆在 $0$ 到 $1$ 小時之間，且所有延遲時間的組合等可能。 先到的人會等 $15$ 分鐘，若對方仍未到就離開。 問：他們會相遇的機率是多少？
  
  ![](image/Figure1.5.png)

- 符號
  - $x$：Romeo 的到達時間
  - $y$：Juliet 的到達時間
  - $M$：Romeo 與 Juliet 相遇的事件
  - $M = \{(x,y)\mid \lvert x-y\rvert \le \tfrac{1}{4},\ 0 \le x \le 1,\ 0 \le y \le 1\}$

- 機率
  $$1 - \left(\tfrac{3}{4}\right)\left(\tfrac{3}{4}\right) = \tfrac{7}{16}$$


## Properties of Probability Laws

- Probability laws 具有許多可由公理推導出的性質。 以下彙整其中一些
-  給定一個 probability law，設 $A, B, C$ 為事件
   - (a) 若 $A \subset B$，則 $P(A) \le P(B)$
   - (b) $P(A \cup B) = P(A) + P(B) - P(A \cap B)$
   - (c) $P(A \cup B) \le P(A) + P(B) \quad \text{(Union Bound / Boole's Inequality).}$
   - (d) $P(A \cup B \cup C) = P(A) + P(A^{c} \cap B) + P(A^{c} \cap B^{c} \cap C).$
- Bonferroni Inequality
  $$P(A \cap B) \ge P(A) + P(B) - 1$$
  $$P(A_{1} \cap \cdots \cap A_{n}) \ge P(A_{1}) + \cdots + P(A_{n}) - (n-1)$$
  - Proof of Bonferroni Inequality

    $$
    \begin{aligned}
    (A_{1} \cap \cdots \cap A_{n})^{c} 
    &= A_{1}^{c} \cup \cdots \cup A_{n}^{c} \\[4pt]
    \Rightarrow\ 
    P\!\left((A_{1} \cap \cdots \cap A_{n})^{c}\right)
    &= P(A_{1}^{c} \cup \cdots \cup A_{n}^{c})
    \le P(A_{1}^{c}) + \cdots + P(A_{n}^{c}) \\[4pt]
    \therefore\ 
    1 - P(A_{1} \cap \cdots \cap A_{n})
    &\le (1 - P(A_{1})) + \cdots + (1 - P(A_{n})) \\[4pt]
    \Rightarrow\ 
    P(A_{1} \cap \cdots \cap A_{n})
    &\ge P(A_{1}) + \cdots + P(A_{n}) - (n-1)
    \end{aligned}
    $$

![](image/Figure1.6.png)

上圖使用 Venn diagrams 對四個 Probability laws 的性質進行視覺化與驗證。 若 $A \subset B$，則 $B$ 可表示為兩個互斥事件 $A$ 與 $A^{c} \cap B$ 的聯集，見圖 (a)。 因此，由 additivity axiom 可得

$$
P(B)=P(A)+P(A^{c}\cap B)\ge P(A) +0 = P(A)
$$

其中不等式來自 nonnegativity axiom，用以驗證性質 (a)

由圖 (b)，我們可以把事件 $A\cup B$ 與 $B$ 表示為互斥事件的聯集：
$$
A\cup B = A\cup (A^{c}\cap B),\qquad
B = (A\cap B)\cup (A^{c}\cap B)
$$

additivity axiom 給出

$$
P(A\cup B)=P(A)+P(A^{c}\cap B),\qquad
P(B)=P(A\cap B)+P(A^{c}\cap B)
$$

把第一個等式減掉第二個等式並重整後，得到

$$
P(A\cup B)=P(A)+P(B)-P(A\cap B)
$$

這驗證了性質 (b)。 再利用 nonnegativity axiom 的事實 $P(A\cap B)\ge 0$，可得

$$
P(A\cup B)\le P(A)+P(B)
$$

驗證性質 (c)

由圖 (c) 可見，事件 $A\cup B\cup C$ 可以表示為三個互斥事件的聯集：

$$
A\cup B\cup C
= A\cup (A^{c}\cap B)\cup (A^{c}\cap B^{c}\cap C)
$$

至此由 additivity axiom 的推得性質 (d) 

## Conditional Probability

- Conditional probability 為我們提供一種在部分資訊下，對實驗結果進行推理的方法
  - 假設結果落在某個已知事件 $B$ 之內，我們希望量化結果同時屬於另一個給定事件 $A$ 的概似性（likelihood）

- 在一個新的 probability law 之下，定義「給定 $B$ 的 $A$ 的 conditional probability」，記作 $P(A\mid B)$，其定義為
  $$
  P(A\mid B)=\frac{P(A\cap B)}{P(B)}
  $$
  - 若 $P(B)=0$，則 $P(A\mid B)$ 未被定義
  - 可以把 $P(A\mid B)$ 理解為：在事件 $B$ 的總機率之中，分配給同時也屬於 $A$ 的可能結果所佔的比例

- 當實驗的所有結果等可能時，conditional probability 亦可定義為
  $$
  P(A\mid B)=\frac{\text{number of elements of }A\cap B}{\text{number of elements of }B}
  $$

- 先驗機率指 $P(A)$ 這種，後驗機率指 $P(A | B)$ 這種在知道某個前提下得出的機率

- 一些與 conditional probability 相關的例子：
  1. 一個涉及連續兩次擲骰的實驗中，已知兩次點數之和為 $9$。 第一顆骰是 $6$ 的 likelihood 多大？
  2. 在猜字遊戲中，單字的第一個字母是 $t$。 第二個字母是 $h$ 的 likelihood 是多少？
  3. 已知某人接受醫學檢測為陰性，他罹患某疾病的 likelihood 有多大？
  4. 雷達螢幕上出現一個光點。 它對應到航空器的 likelihood 有多大？

## Conditional Probabilities Satisfy the Three Axioms

- Nonnegative：
  $$
  P(A\mid B)=\frac{P(A\cap B)}{P(B)}\ge 0
  $$

- Normalization：
  $$
  P(\Omega\mid B)=\frac{P(\Omega\cap B)}{P(B)}=\frac{P(B)}{P(B)}=1
  $$

- Additivity：若 $A_1$ 與 $A_2$ 為兩個互斥事件，
  $$
  \begin{aligned}
  P(A_1\cup A_2\mid B)
  &=\frac{P\big((A_1\cup A_2)\cap B\big)}{P(B)} \quad \text{(distributive)}\\
  &=\frac{P\big((A_1\cap B)\cup(A_2\cap B)\big)}{P(B)} \quad \text{(disjoint sets)}\\
  &=\frac{P(A_1\cap B)+P(A_2\cap B)}{P(B)}\\
  &=P(A_1\mid B)+P(A_2\mid B)
  \end{aligned}
  $$

## Conditional Probabilities Satisfy General Probability Laws

- probability laws 的若干性質（在給定 $B$ 下）：
  - $P(A_1\cup A_2\mid B)=P(A_1\mid B)+P(A_2\mid B)-P(A_1\cap A_2\mid B)$
  - $P(A_1\cup A_2\mid B)\le P(A_1\mid B)+P(A_2\mid B)$
  - …

- Conditional probabilities 也可被視為在新的宇宙 $B$ 上的一個 probability law，因為所有的條件機率都集中於 $B$

  ![](image/ConditionalProbabilitiesSatisfyGeneralProbabilityLaws.png)

### Example 1.6

我們連續擲一枚公平硬幣三次。 欲求 $P(A\mid B)$，其中

$$
A=\{\text{more heads than tails come up}\},\qquad
B=\{\text{1st toss is a head}\}
$$

樣本空間共有八個序列

$$
\Omega=\{\mathrm{HHH},\,\mathrm{HHT},\,\mathrm{HTH},\,\mathrm{HTT},\,\mathrm{THH},\,\mathrm{THT},\,\mathrm{TTH},\,\mathrm{TTT}\}
$$

假設皆等可能。 事件 $B$ 含有四個元素 $\mathrm{HHH},\mathrm{HHT},\mathrm{HTH},\mathrm{HTT}$，因此

$$
P(B)=\frac{4}{8}
$$

事件 $A\cap B$ 含有三個元素 $\mathrm{HHH},\mathrm{HHT},\mathrm{HTH}$，因此

$$
P(A\cap B)=\frac{3}{8}
$$

由此

$$
P(A\mid B)=\frac{P(A\cap B)}{P(B)}=\frac{\frac{3}{8}}{\frac{4}{8}}=\frac{3}{4}
$$

因所有結果等可能，也可用捷徑計算：以 $A$ 與 $B$ 的共同元素個數 $3$ 除以 $B$ 的元素個數 $4$，同樣得到 $3/4$

### Example 1.7

一顆公平 4 面骰擲兩次，假設所有 $16$ 個可能結果等可能。 令 $X,Y$ 分別為第一次與第二次的結果。 欲求 $P(A\mid B)$，其中

$$
A=\{\max(X,Y)=m\},\qquad
B=\{\min(X,Y)=2\}
$$

且 $m$ 取 $1,2,3,4$

結果：

$$
P(\{\max(X,Y)=m\}\mid B)=
\begin{cases}
\dfrac{2}{5}, & m=3\ \text{or}\ 4\\[6pt]
\dfrac{1}{5}, & m=2\\[6pt]
0, & m=1
\end{cases}
$$

![](image/Figure1.7.png)

### Example 1.8

一個保守型設計團隊（記為 $C$）與一個創新型設計團隊（記為 $N$），被要求各自於一個月內設計出一項新產品。 根據過去經驗：

- (a) 團隊 $C$ 成功的機率為 $2/3$
- (b) 團隊 $N$ 成功的機率為 $1/2$
- (c) 至少有一個團隊成功的機率為 $3/4$

假設恰好只有一個成功的設計被產出，問：它是由團隊 $N$ 設計的機率是多少？

四種可能結果（兩隊成功/失敗的組合）：

- $SS$：兩隊都成功
- $FF$：兩隊都失敗
- $SF$：$C$ 成功、$N$ 失敗
- $FS$：$C$ 失敗、$N$ 成功

已知這些結果的機率滿足

$$
P(SS)+P(SF)=\frac{2}{3},\qquad
P(SS)+P(FS)=\frac{1}{2},\qquad
P(SF)+P(FS)=\frac{3}{4}
$$

再配合 normalization

$$
P(SS)+P(SF)+P(FS)+P(FF)=1
$$

可解得各結果之機率

$$
P(SS)=\frac{5}{12},\quad
P(SF)=\frac{1}{4},\quad
P(FS)=\frac{1}{12},\quad
P(FF)=\frac{1}{4}
$$

所求的 conditional probability 為

$$
P\big(\{FS\}\,\big|\,\{SF,FS\}\big)
=\frac{\tfrac{1}{12}}{\tfrac{1}{4}+\tfrac{1}{12}}
=\frac{1}{4}
$$

## Using Conditional Probability for Modeling

- 在建模時，先指定 conditional probabilities，然後再用它們來決定 unconditional probabilities，這通常既自然又方便
- 一種等價的 conditional probability 定義表法為
  $$
  P(A\cap B)=P(B)\,P(A\mid B)
  $$

### Example 1.9. Radar detection

如果某區域內確有飛機存在，雷達能以機率 $0.99$ 正確偵測到其存在； 若並不存在，雷達卻會以機率 $0.10$ 誤報有飛機存在。 我們假設飛機存在的先驗機率為 $0.05$。 問：false alarm（錯誤指示飛機存在）的機率，以及 missed detection（實際有飛機但雷達沒有任何顯示）的機率各為何？

![](image/Figure1.8.png)

使用 Fig. 1.8 的序列化樣本空間描述。 設事件

$$
A=\{\text{an aircraft is present}\},\qquad
B=\{\text{the radar registers an aircraft presence}\}
$$
並考慮其補事件
$$
A^{c}=\{\text{an aircraft is not present}\},\qquad
B^{c}=\{\text{the radar does not register an aircraft presence}\}
$$

則
$$
P(\text{false alarm})=P(A^{c}\cap B)=P(A^{c})P(B\mid A^{c})=0.95\cdot 0.10=0.095
$$
$$
P(\text{missed detection})=P(A\cap B^{c})=P(A)P(B^{c}\mid A)=0.05\cdot 0.01=0.0005
$$

## Multiplication (Chain) Rule

- 假設所有作為條件的事件都具有正機率，則有
  $$
  P\!\left(\bigcap_{i=1}^{n}A_{i}\right)
  =P(A_{1})\,P(A_{2}\mid A_{1})\,P(A_{3}\mid A_{1}\cap A_{2})\cdots
  P\!\left(A_{n}\ \middle|\ \bigcap_{i=1}^{n-1}A_{i}\right)
  $$

- 驗證方式可寫成
  $$
  P\!\left(\bigcap_{i=1}^{n}A_{i}\right)
  =P(A_{1})
  \frac{\cancel{P(A_{1}\cap A_{2})}}{P(A_{1})}
  \frac{P(A_{1}\cap A_{2}\cap A_{3})}{\cancel{P(A_{1}\cap A_{2})}}
  \cdots
  \frac{P\!\left(\bigcap_{i=1}^{n}A_{i}\right)}
       {P\!\left(\bigcap_{i=1}^{n-1}A_{i}\right)}
  $$

- 當 $n=2$ 時，上述乘法法則正是 conditional probability 的定義：
  $$
  P(A_{1}\cap A_{2})=P(A_{1})\,P(A_{2}\mid A_{1})
  $$

### Example 1.10

從一副標準 $52$ 張撲克牌中不放回抽三張，求三張牌中沒有任何一張是 “heart” 的機率

令 $A_{i}=\{\text{第 }i\text{ 張不是 heart}\}$，$i=1,2,3$。 則
$$
P(A_{1}\cap A_{2}\cap A_{3})
= P(A_{1})\,P(A_{2}\mid A_{1})\,P(A_{3}\mid A_{1}\cap A_{2})
= \frac{39}{52}\cdot\frac{38}{51}\cdot\frac{37}{50}
$$

### Example 1.11

一個班級有 $4$ 位研究生與 $12$ 位大學生，隨機分成 $4$ 個、每組 $4$ 人的分組。 問：每個小組都恰有一名研究生的機率為何？

定義事件

$$
A_{1}=\{\text{graduate students 1 與 2 在不同小組}\}
$$
$$
A_{2}=\{\text{graduate students 1、2、3 在不同小組}\}
$$
$$
A_{3}=\{\text{graduate students 1、2、3、4 在不同小組}\}
$$

則

$$
P(A_{3})=P(A_{1}\cap A_{2}\cap A_{3})
= P(A_{1})\,P(A_{2}\mid A_{1})\,P(A_{3}\mid A_{1}\cap A_{2})
$$

其中

$$
P(A_{1})=\frac{12}{15},\qquad
P(A_{2}\mid A_{1})=\frac{8}{14},\qquad
P(A_{3}\mid A_{1}\cap A_{2})=\frac{4}{13}
$$

因此

$$
P(A_{3})=\frac{12}{15}\cdot\frac{8}{14}\cdot\frac{4}{13}
$$

## Total Probability Theorem

設 $A_{1},\dots,A_{n}$ 為將樣本空間分割（partition）的一組互斥事件，且假設對所有 $i$ 均有 $P(A_{i})>0$。 則對任意事件 $B$，有

$$
P(B)=P(A_{1}\cap B)+\cdots+P(A_{n}\cap B)
=P(A_{1})P(B\mid A_{1})+\cdots+P(A_{n})P(B\mid A_{n})
$$

注意：實驗（樣本空間）的每一個可能結果，恰好屬於事件 $A_{1},\dots,A_{n}$ 的其中之一

![](image/Figure1.12.png)

上圖以視覺化方式驗證 Total Probability Theorem。 事件 $A_{1},\dots,A_{n}$ 形成一個樣本空間的分割，因此事件 $B$ 可以分解為它與各 $A_{i}$ 的交集的不相交聯集，即

$$
B=(A_{1}\cap B)\ \cup\ \cdots\ \cup\ (A_{n}\cap B)
$$

由 additivity axiom 可得

$$
P(B)=P(A_{1}\cap B)+\cdots+P(A_{n}\cap B)
$$

又由 conditional probability 的定義

$$
P(A_{i}\cap B)=P(A_{i})\,P(B\mid A_{i})
$$

代入上式得到

$$
P(B)=P(A_{1})P(B\mid A_{1})+\cdots+P(A_{n})P(B\mid A_{n})
$$

### Example 1.13

你參加一場西洋棋賽。 對於一半的選手（type 1），你贏一局的機率是 $0.3$； 對於四分之一的選手（type 2），機率是 $0.4$； 對於剩下四分之一的選手（type 3），機率是 $0.5$。 你將與隨機選中的對手對弈。 問：贏棋的機率是多少？

令 $A_i$ 表示「對手是 type $i$」的事件，則

$$
P(A_1)=0.5,\qquad P(A_2)=0.25,\qquad P(A_3)=0.25
$$

再令 $B$ 為「我贏棋」的事件，則

$$
P(B\mid A_1)=0.3,\qquad P(B\mid A_2)=0.4,\qquad P(B\mid A_3)=0.5
$$

因此由 Total Probability Theorem，

$$
\begin{aligned}
P(B)
&=P(A_1)P(B\mid A_1)+P(A_2)P(B\mid A_2)+P(A_3)P(B\mid A_3)\\
&=0.5\cdot 0.3+0.25\cdot 0.4+0.25\cdot 0.5\\
&=0.375
\end{aligned}
$$

### Example 1.14

擲一顆公平的四面骰。 若第一次結果為 $1$ 或 $2$，則再擲一次； 否則停止。 問：我們兩次點數的總和至少為 $4$ 的機率是多少？

令 $A_i$ 表示「第一次結果為 $i$」的事件，注意對每個 $i$ 都有 $P(A_i)=1/4$。 令 $B$ 為「總和至少為 $4$」的事件。 若發生 $A_1$，則第二次若出現 $3$ 或 $4$（機率 $1/2$），總和至少為 $4$

同理，若發生 $A_2$，則第二次為 $2,3,4$（機率 $3/4$）時總和至少為 $4$； 若發生 $A_3$，我們停止，總和小於 $4$； 若發生 $A_4$，我們停止，且總和至少為 $4$。 因此

$$
P(B\mid A_1)=\tfrac{1}{2},\qquad
P(B\mid A_2)=\tfrac{3}{4},\qquad
P(B\mid A_3)=0,\qquad
P(B\mid A_4)=1
$$

由 Total Probability Theorem，

$$
\begin{aligned}
P(B)
&=\frac14\cdot\frac12+\frac14\cdot\frac34+\frac14\cdot 0+\frac14\cdot 1\\
&=\frac{9}{16}
\end{aligned}
$$

### Example 1.15

Alice 正在修一門機率課； 每週結束時，她要不是 up-to-date，就是落後（behind）。 若某週她是 up-to-date，下一週仍 up-to-date（或變成 behind）的機率分別為 $0.8$（或 $0.2$）； 若某週她是 behind，下一週變為 up-to-date（或仍 behind）的機率分別為 $0.4$（或 $0.6$）。 Alice 在課程開始時（預設）是 up-to-date。 問：三週之後她是 up-to-date 的機率是多少？

記

- $U_i$：第 $i$ 週結束時 up-to-date
- $B_i$：第 $i$ 週結束時 behind

則可以知道

$$
P(U_{i+1})=P(U_i)\cdot 0.8+P(B_i)\cdot 0.4,\quad P(B_{i+1})=P(U_i)\cdot 0.2+P(B_i)\cdot 0.6
$$

因此可知

$$
\begin{aligned}
P(U_3)&=P(U_2)P(U_3\mid U_2)+P(B_2)P(U_3\mid B_2)=P(U_2)\cdot 0.8+P(B_2)\cdot 0.4,\\
P(U_2)&=P(U_1)P(U_2\mid U_1)+P(B_1)P(U_2\mid B_1)=P(U_1)\cdot 0.8+P(B_1)\cdot 0.4,\\
P(B_2)&=P(U_1)P(B_2\mid U_1)+P(B_1)P(B_2\mid B_1)=P(U_1)\cdot 0.2+P(B_1)\cdot 0.6
\end{aligned}
$$

由於 $P(U_1)=0.8,\ P(B_1)=0.2$（$P(U_0)=1$），得

$$
P(U_2)=0.8\cdot 0.8+0.2\cdot 0.4=0.72,\qquad
P(B_2)=0.8\cdot 0.2+0.2\cdot 0.6=0.28
$$

故

$$
P(U_3)=0.72\cdot 0.8+0.28\cdot 0.4=0.688
$$

## Bayes’ Rule

設 $A_1,A_2,\dots,A_n$ 為樣本空間的一組互斥分割，且對所有 $i$ 皆有 $P(A_i)>0$。 對任何使 $P(B)>0$ 的事件 $B$，有

$$
\begin{aligned}
P(A_i\mid B)
&=\frac{P(A_i\cap B)}{P(B)}\\
&=\frac{P(A_i)P(B \mid A_i)}{P(B)} \text{ (Multiplication rule)}\\
&=\frac{P(A_i)\,P(B\mid A_i)}{\sum_{k=1}^{n} P(A_k)\,P(B\mid A_k)} \text{ (Total probability theorem)}\\
&= \frac{\mathbf{P}(A_i)\mathbf{P}(B \mid A_i)}
     {\mathbf{P}(A_1)\mathbf{P}(B \mid A_1) + \cdots + \mathbf{P}(A_n)\mathbf{P}(B \mid A_n)}
\end{aligned}
$$

### Bayes’ Rule and Inference

- 由 Thomas Bayes（約 1701-1761，Presbyterian minister）提出； “Bayes’ theorem” 在其身後發表
- 提供一套從經驗學習並納入新證據的系統化方法
- Bayesian Inference
  - $P(A_i)$：對觀察事件 $B$ 的可能成因 $A_i$ 的先驗機率
  - $P(B\mid A_i)$：在每個 $A_i$ 下建立世界的模型
  - $P(A_i\mid B)$：由觀察結果 $B$ 反推成因的機率

### Inference Using Bayes’ Rule

![](image/Figure1.13.png)

上圖為 Bayes’ rule 隱含的推論情境範例。 我們在某人的 X-ray 上觀察到一個陰影（事件 $B$，即「effect」），欲估計三個互斥且完備的潛在成因的 likelihood：

- 成因 1（事件 $A_1$）為惡性腫瘤（Malignant Tumor）
- 成因 2（事件 $A_2$）為良性腫瘤（Nonmalignant Tumor）
- 成因 3（事件 $A_3$）是非腫瘤的其他原因

我們假定已知 $P(A_i)$ 與 $P(B\mid A_i)$，$i=1,2,3$。 既然看到了陰影（事件 $B$ 發生），Bayes’ rule 給出各成因的條件機率：

$$
P(A_i\mid B)
=\frac{P(A_i)\,P(B\mid A_i)}
       {P(A_1)P(B\mid A_1)+P(A_2)P(B\mid A_2)+P(A_3)P(B\mid A_3)}
\quad i=1,2,3
$$

另一種等價觀點是右圖的序列模型：$P(A_1\mid B)$ 等於高亮葉節點中 $P(A_1\cap B)$ 與其總機率 $P(B)$ 的比值

### Example 1.18. The False-Positive Puzzle

對某疾病的檢測，其正確率假設為 $95\%$：若受檢者確實有病，檢測呈陽性之機率為 $0.95$（$P(B\mid A)=0.95$）； 若受檢者無病，檢測呈陰性之機率為 $0.95$（$P(B^{c}\mid A^{c})=0.95$）。 某族群中，任一人的患病先驗機率為 $0.001$（$P(A)=0.001$）。 已知此人檢測呈陽性，問：他實際患病的機率 $P(A\mid B)$ 為何？

其中

- $A$: 此人有病（$A^{c}$：無病）  
- $B$: 檢測為陽性（$B^{c}$：檢測為陰性）

由 Bayes’ rule，

$$
\begin{aligned}
P(A\mid B)
&=\frac{P(A)P(B\mid A)}{P(B)}\\
&=\frac{P(A)P(B\mid A)}{P(A)P(B\mid A)+P(A^{c})P(B\mid A^{c})}\\
&=\frac{0.001\cdot 0.95}{0.001\cdot 0.95+0.999\cdot 0.05}\\
&=0.0187
\end{aligned}
$$

## Independence（獨立）

- 回顧：條件機率 $P(A\mid B)$ 捕捉了事件 $B$ 對事件 $A$ 所提供的部分資訊
- 有一個特殊情形：當 $B$ 的發生不提供任何資訊，且不改變 $A$ 發生的機率時：
  
  $$
  P(A\mid B)=P(A)
  $$
  
  此時稱 $A$ 與 $B$ 為 independent（$B$ 也與 $A$ independent），由定義可得

  $$
  P(A\mid B)=\frac{P(A\cap B)}{P(B)}=P(A)
  \;\;\Rightarrow\;\;
  P(A\cap B)=P(A)P(B)
  $$

- $A$ 與 $B$ 為 independent 無法推出 $A$ 與 $B$ 為 disjoint（互斥）
  - 若 $A$ 與 $B$ 互斥，則 $P(A\cap B)=0$
  - 然而，若 $P(A)>0$ 且 $P(B)>0$，則
    $$
    P(A\cap B)\neq P(A)P(B)
    $$
  - 因此，independence 並不等於 disjoint（也難以單靠樣本空間圖像來視覺化）

- 兩個互斥且 $P(A)>0$、$P(B)>0$ 的事件永遠不會 independent
- 任一事件與 no outcome 的事件（即 empty event）彼此 independent
- 任一事件與其補事件不為 independent。 實際上，若 $0<P(A)<1$，則
  $$
  P\bigl(A\cap A^{c}\bigr)\neq P(A)P(A^{c})
  $$

### Example 1.19

考慮：擲一個四面骰兩次，共 $16$ 個等可能結果，每一對結果的機率均為 $1/16$

#### (a) 事件

$A_i=\{\text{第 1 次擲得 } i\}$，$B_j=\{\text{第 2 次擲得 } j\}$，是否 independent？

因為各結果等可能：

$$
P(A_i\cap B_j)=\frac{1}{16},\qquad
P(A_i)=\frac{4}{16},\quad
P(B_j)=\frac{4}{16}
$$

故

$$
P(A_i\cap B_j)=P(A_i)P(B_j)
$$

所以 $A_i$ 與 $B_j$ independent

> 若兩事件由兩個獨立且互不作用的物理過程主導，其結果往往會是 independent

#### (b) 事件

$A=\{\text{第 1 次擲出 }1\}$，$B=\{\text{兩次點數和為 }5\}$，是否 independent？

$$
P(A)=\frac{4}{16}\quad(\text{兩次結果為 }(1,1),(1,2),(1,3),(1,4))
$$

$$
P(B)=\frac{4}{16}\quad(\text{兩次結果為 }(1,4),(2,3),(3,2),(4,1))
$$

$$
P(A\cap B)=\frac{1}{16}\quad(\text{唯一同時滿足的是 }(1,4))
$$

因此

$$
P(A\cap B)=P(A)P(B)
$$

故 $A$ 與 $B$ independent

#### (c) 事件

$A=\{\text{兩次點數的最大值為 }2\}$，$B=\{\text{兩次點數的最小值為 }2\}$，是否 independent？

$$
P(A)=\frac{3}{16}\quad(\text{兩次結果為 }(1,2),(2,1),(2,2))
$$

$$
P(B)=\frac{5}{16}\quad(\text{兩次結果為 }(2,2),(2,3),(2,4),(3,2),(4,2))
$$

$$
P(A\cap B)=\frac{1}{16}\quad(\text{唯一同時滿足的是 }(2,2))
$$

因此

$$
P(A\cap B)\neq P(A)P(B)
$$

故 $A$ 與 $B$ dependent

## Independence of Event Complements

若 $A$ 與 $B$ independent，則以下也成立：

- (i) $A$ 與 $B^{c}$ independent
- (ii) $A^{c}$ 與 $B^{c}$ independent
- 我們要如何驗證？（參見 Problem 43）

證明 (i)：若 $A$ 與 $B$ independent，則 $A$ 與 $B^{c}$ 亦 independent

Proof：

$$
A=(A\cap B)\cup(A\cap B^{c})
\;\;\Rightarrow\;\;
P(A)=P(A\cap B)+P(A\cap B^{c})
$$

又因 $A$ 與 $B$ independent，$P(A\cap B)=P(A)P(B)$，故

$$
\begin{aligned}
P(A\cap B^{c})
&=P(A)-P(A\cap B)\\
&=P(A)-P(A)P(B)\\
&=P(A)\bigl(1-P(B)\bigr)\\
&=P(A)P(B^{c})
\end{aligned}
$$

因此，$A$ 與 $B^{c}$ independent

## conditional independence

- 給定事件 $C$，若
  $$
  \mathbf{P}(A\cap B\mid C)=\mathbf{P}(A\mid C)\mathbf{P}(B\mid C)
  $$
  則稱事件 $A$ 和 $B$ 在條件 $C$ 下為 **conditionally independent**

- 我們也知道（乘法律）：
  $$
  \mathbf{P}(A\cap B\mid C)
  =\frac{\mathbf{P}(A\cap B\cap C)}{\mathbf{P}(C)}
  =\frac{\mathbf{P}(C)\mathbf{P}(B\mid C)\mathbf{P}(A\mid B\cap C)}{\mathbf{P}(C)}
  $$

- 若 $\mathbf{P}(B\mid C)>0$，則可用另一種方式表達 **conditional independence**：
  $$
  \mathbf{P}(A\mid B\cap C)=\mathbf{P}(A\mid C)
  $$

- 請注意：就**無條件**機率律而言，$A$ 與 $B$ 的獨立不代表條件獨立，反之亦然
  $$
  \mathbf{P}(A\cap B)=\mathbf{P}(A)\mathbf{P}(B)\not\Leftrightarrow
  \mathbf{P}(A\cap B\mid C)=\mathbf{P}(A\mid C)\mathbf{P}(B\mid C)
  $$

- 思考：若 $A$ 與 $B$ 獨立，當 $C$ 已發生時，$A$ 與 $B$ 是否仍獨立？（未必）

### **Example 1.20.** 

兩次獨立且公平的擲幣，四種結果等可能。 令

- $H_1={\text{第一次為正面}}$，對應 $(H,T),(H,H)$；
- $H_2={\text{第二次為正面}}$，對應 $(T,H),(H,H)$；
- $D={\text{兩次結果不同}}$，對應 $(T,H),(H,T)$

則
$$
\mathbf{P}(H_1\mid D)=\tfrac12,\qquad
\mathbf{P}(H_2\mid D)=\tfrac12
$$
但
$$
\mathbf{P}(H_1\cap H_2\mid D)
=\frac{\mathbf{P}(H_1\cap H_2\cap D)}{\mathbf{P}(D)}
=0\neq \mathbf{P}(H_1\mid D)\mathbf{P}(H_2\mid D)
$$

- 結論：$H_1$ 與 $H_2$ 在條件 $D$ 下是**相依**的（非條件獨立）

### **Example 1.21.**

有兩枚硬幣：一枚 **blue**、一枚 **red**

- 隨機選一枚，機率各為 $1/2$，接著用所選硬幣擲兩次（對所選硬幣而言兩次互相獨立）
- 硬幣有偏：**blue** 的正面機率 $0.99$；**red** 的正面機率 $0.01$
- 令 $B$ 表示「選到 **blue**」，令 $H_i$ 表示「第 $i$ 次為正面」

條件情形（給定選擇的硬幣）：

$$
\mathbf{P}(H_1\cap H_2\mid B)=\mathbf{P}(H_1\mid B)\mathbf{P}(H_2\mid B)
$$

因為給定硬幣後，$H_1, H_2$ 相互獨立

無條件情形：

$$
\mathbf{P}(H_1)=\mathbf{P}(B)\mathbf{P}(H_1\mid B)+\mathbf{P}(B^c)\mathbf{P}\left(H_1\mid B^c\right)=\tfrac12\cdot0.99+\tfrac12\cdot0.01=\tfrac12
$$
$$
\mathbf{P}(H_2)=\mathbf{P}(B)\mathbf{P}(H_2\mid B)+\mathbf{P}(B^c)\mathbf{P}\left(H_2\mid B^c\right)=\tfrac12\cdot0.99+\tfrac12\cdot0.01=\tfrac12
$$
$$
\mathbf{P}(H_1\cap H_2)
=\mathbf{P}(B)\mathbf{P}(H_1\cap H_2\mid B)+\mathbf{P}(B^c)\mathbf{P}\left(H_1\cap H_2\mid B^c\right)
=\tfrac12\cdot0.99\cdot0.99+\tfrac12\cdot0.01\cdot0.01\neq\tfrac14
$$

![](image/Figure1.15.png)

## Independence of a collection of events

- 我們稱事件 $A_1,A_2,\ldots,A_n$ **獨立**，若對於 $\{1,2,\ldots,n\}$ 的任意子集 $S$ 均有
  $$
  \mathbf{P}\left(\bigcap_{i\in S}A_i\right)=\prod_{i\in S}\mathbf{P}(A_i)
  $$

- 例如，三個事件 $A_1,A_2,A_3$ 的獨立需滿足以下四個條件（總數 $2^n-n-1$）：
  $$
  \mathbf{P}(A_1\cap A_2)=\mathbf{P}(A_1)\mathbf{P}(A_2)
  $$
  $$
  \mathbf{P}(A_1\cap A_3)=\mathbf{P}(A_1)\mathbf{P}(A_3)
  $$
  $$
  \mathbf{P}(A_2\cap A_3)=\mathbf{P}(A_2)\mathbf{P}(A_3)
  $$
  $$
  \mathbf{P}(A_1\cap A_2\cap A_3)=\mathbf{P}(A_1)\mathbf{P}(A_2)\mathbf{P}(A_3)
  $$
- 獨立意味著：該集合中**任意數量**事件的發生或不發生，都不會提供關於其餘事件或其補事件的任何資訊
- 若各事件獨立，可得到例如：
  $$
  \mathbf{P}(A_1\cup A_2\mid A_3\cap A_4)=\mathbf{P}(A_1\cup A_2)
  $$
  或
  $$
  \mathbf{P}\left(A_1\cup A_2^{c}\mid A_3^{c}\cap A_4\right)
  =\mathbf{P}(A_1\cup A_2^{c})
  $$

### Example 1.22. Pairwise independence does not imply independence

思考兩次相互獨立且公平的擲幣，以及以下事件：

- $H_1=\{\text{1st toss is a head}\}$，對應樣本點 $(H,T),(H,H)$
- $H_2=\{\text{2nd toss is a head}\}$，對應樣本點 $(T,H),(H,H)$
- $D=\{\text{the two tosses have different results}\}$，對應樣本點 $(T,H),(H,T)$

根據定義，有
$$
P(H_1\cap H_2)=P(H_1)P(H_2)
$$
$$
P(H_1\cap D)=P(H_1)P(D)
$$
$$
P(H_2\cap D)=P(H_2)P(D)
$$
然而，
$$
P(H_1\cap H_2\cap D)=0\neq P(H_1)P(H_2)P(D)
$$

### Example 1.23. The following equality is not enough for independence

$$
P(A_1\cap A_2\cap A_3)=P(A_1)P(A_2)P(A_3)
$$

思考兩次相互獨立的擲六面公平骰，並定義事件：

- $A=\{\text{1st roll is 1, 2, or 3}\}$
- $B=\{\text{1st roll is 3, 4, or 5}\}$
- $C=\{\text{the sum of the two rolls is 9}\}$

計算得到
$$
P(A\cap B\cap C)=\frac{1}{36}=\frac{1}{2}\cdot\frac{1}{2}\cdot\frac{4}{36}=P(A)P(B)P(C)
$$
但是，
$$
P(A\cap B)=\frac{1}{6}\neq \frac{1}{2}\cdot\frac{1}{2}=P(A)P(B)
$$
$$
P(A\cap C)=\frac{1}{36}\neq \frac{1}{2}\cdot\frac{4}{36}=P(A)P(C)
$$
$$
P(B\cap C)=\frac{1}{12}\neq \frac{1}{2}\cdot\frac{4}{36}=P(B)P(C)
$$

### Example 1.24. Network connectivity.

一個電腦網路透過中繼節點 $C,D,E,F$ 連接兩個節點 $A$ 與 $B$

![](image/Figure1.14.png)

- 對於每一對直接相連的節點（記作 $i$ 與 $j$），連線 $i\to j$ 為「up」的機率為 $p_{ij}$。 假設各連線的失效彼此獨立
- 問：在所有連線皆為 up 的情況下，存在一條連通 $A$ 與 $B$ 的路徑的機率是多少？

對於基本模組：
$$
P(\text{series subsystem succeeds})=p_1p_2\cdots p_n
$$
$$
\begin{aligned}
P(\text{parallel subsystem succeeds})
&=1-P(\text{parallel subsystem fails})\\
&=1-(1-p_1)(1-p_2)\cdots(1-p_n)
\end{aligned}
$$

> 某個子系統的失效不依賴其他子系統

先求從 $C$ 到 $B$ 的成功機率（兩條併聯路徑 $C\to E\to B$ 與 $C\to F\to B$）：

$$
\begin{aligned}
P(C\to B)
&=1-(1-P(C\to E\to B))(1-P(C\to F\to B))\\
&=1-(1-0.8\cdot 0.9)(1-0.95\cdot 0.85)\\
&=0.946
\end{aligned}
$$

再計算兩條從 $A$ 到 $B$ 的路徑（彼此併聯）：
$$
P(A\to C\to B)=P(A\to C)\,P(C\to B)=0.9\cdot 0.946=0.851
$$
$$
P(A\to D\to B)=P(A\to D)\,P(D\to B)=0.75\cdot 0.95=0.712
$$

因此整體 $A\to B$ 連通的機率為

$$
\begin{aligned}
P(A\to B)
&=1-(1-P(A\to C\to B))(1-P(A\to D\to B))\\
&=1-(1-0.851)\,(1-0.712)\\
&=0.957
\end{aligned}
$$

## Recall: Counting in Probability Calculation

- 離散均勻機率律（discrete uniform probability law）的兩個應用
  - 當樣本空間 $\Omega$ 具有有限個且等可能的結果時，任一事件 $A$ 的機率為
    $$
    P(A)=\dfrac{\text{number of elements of }A}{\text{number of elements of }\Omega} 
    $$
  - 當我們要計算事件 $A$ 的機率，且其具有有限個等可能的結果，而每個結果已知機率為 $p$，則 $A$ 的機率為
    $$
    P(A)=p\cdot (\text{number of elements of }A) 
    $$

    例子如擲公平硬幣 $n$ 次，要得到剛好 $k$ 個正面

    - 每一條長度為 $n$ 的正反面序列機率都是 ($p=(1/2)^n$)
    - 符合「有 $k$ 個正面」的序列共有 ($\binom{n}{k}$) 條
      所以
      $$
      P(\text{k 個正面})=\binom{n}{k}(1/2)^n
      $$

    若硬幣正面機率是 $q$，則每條“恰有 $k$ 個正面”的序列機率相同為 $q^k(1-q)^{n-k}$，因此
    $P=\binom{n}{k}q^k(1-q)^{n-k}$


### The Counting Principle

- 考慮一個由 $r$ 個階段組成的過程。 設：
  - (a) 第一個階段有 $n_{1}$ 種可能結果
  - (b) 對於第一個階段的每一種可能結果，第二個階段有 $n_{2}$ 種可能結果
  - (c) 更一般地，對於前 $i-1$ 個階段所有可能結果，第 $i$ 個階段有 $n_{i}$ 種可能結果
- 則此 $r$ 階段過程的所有可能結果總數為 $n_{1}n_{2}\cdots n_{r}$

### Common Types of Counting

- $n$ 個物件的排列（permutations）
  $$
  n!=n\cdot (n-1)\cdot (n-2)\cdots 2\cdot 1 
  $$
- $n$ 個物件中取 $k$ 的排列（$k$-permutations）
  $$
  \dfrac{n!}{(n-k)!} 
  $$
- 從 $n$ 個物件中取 $k$ 的組合（combinations）
  $$
  \binom{n}{k}=\dfrac{n!}{k!(n-k)!} 
  $$
- 將 $n$ 個物件分成 $r$ 組，其中第 $i$ 組有 $n_{i}$ 個物件（multinomial/partitions）
  $$
  \binom{n}{n_{1},n_{2},\ldots ,n_{r}}=\dfrac{n!}{n_{1}!\,n_{2}!\cdots n_{r}!} 
  $$


### Summary of Chapter 1

- 一個機率問題通常可拆成幾個基本步驟：
   1. 描述樣本空間，即某個實驗的所有可能結果集合
   2. （可能是間接地）給出機率律的規定（每個事件的機率）
   3. 計算各種感興趣事件的機率與條件機率

- 三種常見的機率計算方法
  - counting method：若結果數有限且彼此等可能
    $$
    P(A)=\dfrac{\text{number of elements of }A}{\text{number of elements of }\Omega} 
    $$
  - sequential method：使用乘法（chain）法則
    $$
    P\!\left(\bigcap_{i=1}^{n}A_{i}\right)=P(A_{1})P(A_{2}\mid A_{1})P(A_{3}\mid A_{1}\cap A_{2})\cdots P\!\left(A_{n}\mid \bigcap_{i=1}^{n-1}A_{i}\right) 
    $$
  - divide-and-conquer method：根據一組條件機率求得事件的機率
    $$
    P(B)=P(A_{1}\cap B)+\cdots +P(A_{n}\cap B) 
    $$
    $$
    =P(A_{1})P(B\mid A_{1})+\cdots +P(A_{n})P(B\mid A_{n}) 
    $$
    $A_{1},\cdots ,A_{n}$ 是構成樣本空間分割的互斥事件

## 隨機變數（Random Variables）

- 給定一個實驗以及其對應的所有可能結果（樣本空間），**隨機變數**會把**每個**結果對應到一個特定的數字  
  - 這個數字稱為隨機變數的（數值）**取值**  
  - 以數學語言來說，可以說**隨機變數是實驗結果上的一個實值函數**，亦即「以實驗結果為自變數的函數」  

  $$
  X: w \to x 
  $$

  ![](image/Figure2.1-1.png)

  上圖示意：Domain（結果）在樣本空間 $\Omega$ 中，經由隨機變數 $X$ 對應到實數軸上的 Range（$X$ 的取值）
- 另一個例子
  - 一個實驗由擲兩次四面骰組成，令隨機變數為**兩次擲得點數的最大值**  
    - 若實驗結果是 $(4,2)$，則隨機變數的值為 $4$  
    - 若實驗結果是 $(3,3)$，則隨機變數的值為 $3$  
  - 這種對應可以是「一對一」或「多對一」
    ![](image/Figure2.1-2.png)

### 與隨機變數相關的主要概念

在一個機率模型中：  

- 隨機變數是實驗結果上的**實值函數**  
  $$
  X: w \to x 
  $$
- **隨機變數的函數**定義出另一個隨機變數  
  $$
  Y=g(X) 
  $$
- 每個隨機變數都可對應一些我們關心的「平均量」，例如 **mean** 與 **variance**  
- 隨機變數可以在某個事件上，或在另一個隨機變數上，進行**條件化**（conditioned）  
- 也有「來自某事件或另一個隨機變數的**獨立性**」這樣的概念

### 離散／連續隨機變數

- 若隨機變數的 **range**（可取的值的集合）是有限或至多可數無限，稱為**離散（discrete）**  
  例如有限：$\{1,2,3,4\}$；可數無限：$\{1,2,\dots\}$  
- 若其 **range** 是不可數無限，則稱為**連續（continuous, 非離散）**  
  - 例：從區間 $[-1,1]$ 中選一點 $a$ 的實驗  
    - 若某隨機變數把結果 $a$ 對應成數值 $a^2$，那它就不是離散的  

### 與離散隨機變數相關的概念

- 在機率模型中：  
  - **離散隨機變數**是實驗結果上的實值函數，能取有限或可數無限多個數值  
  - 離散隨機變數對應一個 **probability mass function（PMF）**，給出該隨機變數每個數值所對應的機率  
    - PMF 可視為某個隨機變數的「**probability law**」或「**probability distribution**」  
  - **隨機變數的函數**會定義另一個隨機變數，而其 PMF 可由原始隨機變數的 PMF 推得  
    - 若 $X$ 是隨機變數且 $g(X)$ 是 $X$ 的函數，則 $g(X)$ 也是隨機變數

## 機率質量函數（PMF）

- 一個（離散）隨機變數 $X$ 可由其可取值的機率來刻畫，這由其 **PMF** 給出，記為  
  $$
  p_X(x) 
  $$
  也可寫作  
  $$
  p_X(x)=\mathsf{P}(\{X=x\})=\mathsf{P}(X=x) 
  $$
- 會導致 $X$ 取成 $x$ 的所有結果之機率總和，等於 $p_X(x)$  
- 慣例：大寫字母（如 $X$）代表隨機變數，小寫字母（如 $x$）代表其數值  
- PMF 在所有可能數值上的總和為 $1$  
  $$
  \sum_x p_X(x)=1 
  $$
  其中各事件 $\{X=x\}$ **兩兩互斥**，且在樣本空間上形成一個**劃分**（partition）

### 如何計算 PMF

- 對於隨機變數 $X$ 的每個可能數值 $x$：  
  1. **蒐集**所有會讓事件 $\{X=x\}$ 發生的可能結果  
  2. **加總**這些結果的機率，得到 $p_X(x)$  
- 例：公平四面骰獨立擲兩次，令 $X$ 為「兩次擲得點數的最大值」的 PMF  
  共有 $16$ 個等可能結果。 當 $X=m$ 時，符合的結果數是 $m^2-(m-1)^2=2m-1$，故  
    $$
    p_X(1)=\frac{1}{16},\quad p_X(2)=\frac{3}{16},\quad p_X(3)=\frac{5}{16},\quad p_X(4)=\frac{7}{16} 
    $$
  ![](image/Figure2.2.png)

## Bernoulli Random Variable

- 一個 Bernoulli random variable $X$ 只取兩個值 $1$ 與 $0$，其機率分別為 $p$ 與 $1-p$ 
  
  **PMF**：
  
  $$
  p_X(x)=
  \begin{cases}
  p, & \text{if } x=1 \\
  1-p, & \text{if } x=0
  \end{cases}
  $$

- Bernoulli random variable 經常用來刻畫僅有兩種結局的通用機率情境，如：  
  1. 擲硬幣一次（結果：head 與 tail）  
  2. 一次試驗（結果：success 與 failure）  
  3. 電話線路狀態（結果：free 與 busy）  

- **Normalization Property（歸一化性質）**：$p_X(0)+p_X(1)=1$

- Bernoulli 是 Binomial 在 $n=1$ 的特例

- 一個 binomial random variable $X$ 的參數為 $n$ 與 $p$
  
  **PMF**：
  
  $$
  p_X(k)=\mathbf P(X=k)=\binom{n}{k}p^k(1-p)^{\,n-k},\quad k=0,1,\dots,n
  $$

- Bernoulli random variable 可用於建模的例子  
  1. $n$ 次互相獨立擲硬幣中 head 的個數（可能結果：$1,2,\dots,n$），每次擲出 head 的機率為 $p$  
  2. $n$ 次互相獨立試驗中的 success 個數（可能結果：$1,2,\dots,n$），每次成功的機率為 $p$

> 註：此處以及其他地方，我們簡化記號，使用 $k$（而非 $x$）來表示整數值 random variable 的取值

### Normalization Property（Binomial）

$$
\sum_{k=0}^{n}p_X(k)=\sum_{k=0}^{n}\binom{n}{k}p^{\,k}(1-p)^{\,n-k}=1
$$

> 注意：$(a+b)^n=\sum_{k=0}^{n}\binom{n}{k}a^k b^{\,n-k}$

![](image/Figure2.3.png)

Example：三次互相獨立擲硬幣時 head 的數目

$$
p_X(1)=\mathbf P(X=1)=\mathbf P(HTT)+\mathbf P(THT)+\mathbf P(TTH)=3p(1-p)^2=\binom{3}{1}p(1-p)^2
$$

## Geometric Random Variable

- 一個 geometric random variable $X$ 的參數為 $p$（$0<p<1$）
  
  **PMF**：
  
  $$
  p_X(k)=(1-p)^{k-1}p,\quad k=1,2,\dots
  $$

- 幾個可用 geometric random variable 建模的例子  
  - 第一次出現 head 所需的獨立擲硬幣次數，每次擲出 head 的機率為 $p$  
  - 直到（且包含）第一次 success 所需的獨立試驗次數，每次成功機率為 $p$

- **Normalization Property**
  
  $$
  \sum_{k=1}^{\infty}p_X(k)=\sum_{k=1}^{\infty}(1-p)^{k-1}p
  =p\sum_{k=0}^{\infty}(1-p)^{k}
  =p\cdot\frac{1}{1-(1-p)}=1
  $$

  可以從**無限等比和**簡單推得： $\sum r^{k}=1/(1-r)$（取 $r=1-p$）

![](image/Figure2.4.png)

### 等差級數（Arithmetic series）

**定義**：首項 $a_1$，公差 $d$。
第 $n$ 項：

$$
a_n=a_1+(n-1)d
$$

**前 $n$ 項和**：

$$
S_n=\frac{n}{2},(a_1+a_n)=\frac{n}{2}\bigl(2a_1+(n-1)d\bigr)
$$

**簡單推導** 

把和式正向、反向相加：

$$
\begin{aligned}
S_n&=(a_1)+(a_1+d)+\cdots+(a_1+(n-1)d)\\
S_n&=(a_1+(n-1)d)+\cdots+(a_1+d)+(a_1)
\end{aligned}
$$

逐項相加得 $2S_n=n(a_1+a_n)$ ⇒ 上式成立

### 等比級數（Geometric series）

**定義**：首項 $a$，公比 $r$

第 $n$ 項：$a r^{n-1}$

**有限和（前 $n$ 項）**：

$$
S_n=a\frac{1-r^n}{1-r}\quad (r\neq 1).
$$

**簡單推導（乘上 $r$ 後相減）**

令 $S_n=a(1+r+\cdots+r^{n-1})$。 則

$$
rS_n=a(r+r^2+\cdots+r^n).
$$

兩式相減得

$$
(1-r)S_n=a(1-r^n)\ \Rightarrow\ S_n=a\frac{1-r^n}{1-r}.
$$

**無限等比和（$|r|<1$）**：

$$
\sum_{k=0}^{\infty} ar^k=\frac{a}{1-r}.
$$

這是取 $n\to\infty$ 且 $r^n\to 0$ 的結果

## Poisson Random Variable 

- 一個 Poisson random variable $X$ 的參數為 $\lambda$
  
  **PMF**：
  
  $$
  p_X(k)=e^{-\lambda}\frac{\lambda^k}{k!},\quad k=0,1,2,\dots
  $$

- Poisson random variable 的應用例子  
  - 一本書中的錯字數量  
  - 某城市在某一天內涉及車禍的汽車數量

- **Normalization Property**
  
  $$
  \sum_{k=0}^{\infty}p_X(k)=\sum_{k=0}^{\infty}e^{-\lambda}\frac{\lambda^k}{k!}
  =e^{-\lambda}\left(1+\lambda+\frac{\lambda^2}{2!}+\frac{\lambda^3}{3!}+\cdots\right)=1
  $$

  其中 

  $$
  e^{\lambda}=\left(1+\lambda+\frac{\lambda^2}{2!}+\frac{\lambda^3}{3!}+\cdots\right) \text{ (馬克勞林級數)}
  $$
  
![](image/Figure2.5.png)

### Relationship between Binomial and Poisson

具有參數 $\lambda$ 的 Poisson PMF 是具有參數 $n$ 與 $p$ 的 binomial PMF 的良好近似，只要 $\lambda=np$、$n$ 非常大且 $p$ 非常小，對於 binomial PMF：

$$
\begin{aligned}
&\lim_{n\to\infty}\binom{n}{k}p^k(1-p)^{\,n-k}\\
&=\lim_{n\to\infty}\frac{n!}{(n-k)!\,k!}\,p^k(1-p)^{\,n-k} \qquad (\because \lambda=np\Rightarrow p=\frac{\lambda}{n})\\
&=\lim_{n\to\infty}\frac{n(n-1)\cdots(n-k+1)}{k!}\left(\frac{\lambda}{n}\right)^k\left(1-\frac{\lambda}{n}\right)^{\,n-k}\\
&=\lim_{n\to\infty}\frac{\lambda^k}{k!}\cdot\frac{n(n-1)\cdots(n-k+1)}{n^k}\cdot\left(1-\frac{\lambda}{n}\right)^{\,n-k}\\
&=\lim_{n\to\infty}\frac{\lambda^k}{k!}\left(\left(\frac{n}{n}\right)\left(\frac{n-1}{n}\right)\cdots\left(\frac{n-k+1}{n}\right)\right)\left(1-\frac{\lambda}{n}\right)^{\,n-k}
\end{aligned}
$$

前面那部分，因為每個因子 $1-\frac{j}{n}\to 1$，且只有有限個（$k$ 個）因子，所以趨近於 1：

$$
\prod_{j=0}^{k-1}\left(1-\frac{j}{n}\right)\xrightarrow[n\to\infty]{} \prod_{j=0}^{k-1} 1 = 1
$$

對於後面那部分：

$$
\left(1-\frac{\lambda}{n}\right)^{n-k}
=\left(1-\frac{\lambda}{n}\right)^{n}\cdot\left(1-\frac{\lambda}{n}\right)^{-k}
\xrightarrow[n\to\infty]{} e^{-\lambda}\cdot 1 = e^{-\lambda}
$$

這裡用到標準極限

$$
\left(1+\frac{t}{n}\right)^{n}\xrightarrow[n\to\infty]{} e^{t}
\quad(\text{取 }t=-\lambda).
$$

把前後的極限相乘： $1\times e^{-\lambda}=e^{-\lambda}$，推得

$$
\lim_{n\to\infty}\frac{\lambda^k}{k!}\left(\cdots\right)
=\frac{\lambda^k}{k!}e^{-\lambda}.
$$

因此極限為 $e^{-\lambda}\dfrac{\lambda^k}{k!}$，即 Poisson PMF

## Functions of Random Variables

- 給定一個隨機變數 $X$，透過對 $X$ 施加各種變換，可以產生其他隨機變數  
  
  ![](image/PPT5-20.png)
  - 線性  
    $$
    Y=g(X)=aX+b 
    $$
    例：每日溫度以華氏度表示 → 每日溫度以攝氏度表示 
  - 非線性  
    $$
    Y=g(X)=\log X 
    $$

- 映射可以是「一對一」或「多對一」的
- 換言之，若 $Y$ 是 $X$ 的函數（$Y=g(X)$），則 $Y$ 也是隨機變數
- 若 $X$ 是離散的，且其 PMF 為 $p_X(x)$，則 $Y$ 亦為離散的，且其 PMF 可由下式計算  
  $$
  p_Y(y)=\sum_{\{x\,|\,g(x)=y\}} p_X(x) 
  $$

### Example 2.1

令 $Y=|X|$，並將前述 $p_Y$ 的公式應用於下列情形  

$$
p_X(x)=
\begin{cases}
\frac{1}{9}, & \text{若 } x \text{ 為區間 }[-4,4] \text{ 內的整數} \\
0, & \text{otherwise}
\end{cases}
$$

$Y$ 的可能取值為 $y=0,1,2,3,4$。 要計算某個 $y$ 的 $p_Y(y)$，需將所有滿足 $|x|=y$ 的 $x$ 之 $p_X(x)$ 相加。 注意對 $y=0$ 僅有 $x=0$，因此  

$$
p_Y(0)=p_X(0)=\frac{1}{9} 
$$

對 $y=1,2,3,4$，各有兩個對應的 $x$ 值，例： 

$$
p_Y(1)=p_X(-1)+p_X(1)=\frac{2}{9} 
$$

因此 $Y$ 的 PMF 為  

$$
p_Y(y)=
\begin{cases}
\frac{2}{9}, & y=1,2,3,4 \\
\frac{1}{9}, & y=0 \\
0, & \text{otherwise}
\end{cases}
$$

![](image.png)

再舉一個相關例子，令 $Z=X^2$。 可將其視為 $X$ 的平方，或視為 $Y$ 的平方。 由公式 

$$
p_Z(z)=\sum_{\{x\,|\,x^2=z\}}p_X(x)
$$ 

或 

$$
p_Z(z)=\sum_{\{y\,|\,y^2=z\}}p_Y(y)
$$

得  

$$
p_Z(z)=
\begin{cases}
\frac{2}{9}, & z=1,4,9,16 \\
\frac{1}{9}, & z=0 \\
0, & \text{otherwise}
\end{cases}
$$
