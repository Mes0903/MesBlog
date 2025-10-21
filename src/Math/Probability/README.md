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
P(B)=P(A)+P(A^{c}\cap B)\ge P(A) +0 = P(A),
$$

其中不等式來自 nonnegativity axiom，用以驗證性質 (a)

由圖 (b)，我們可以把事件 $A\cup B$ 與 $B$ 表示為互斥事件的聯集：
$$
A\cup B = A\cup (A^{c}\cap B),\qquad
B = (A\cap B)\cup (A^{c}\cap B).
$$

additivity axiom 給出

$$
P(A\cup B)=P(A)+P(A^{c}\cap B),\qquad
P(B)=P(A\cap B)+P(A^{c}\cap B).
$$

把第一個等式減掉第二個等式並重整後，得到

$$
P(A\cup B)=P(A)+P(B)-P(A\cap B),
$$

這驗證了性質 (b)。 再利用 nonnegativity axiom 的事實 $P(A\cap B)\ge 0$，可得

$$
P(A\cup B)\le P(A)+P(B),
$$

驗證性質 (c)

由圖 (c) 可見，事件 $A\cup B\cup C$ 可以表示為三個互斥事件的聯集：

$$
A\cup B\cup C
= A\cup (A^{c}\cap B)\cup (A^{c}\cap B^{c}\cap C),
$$

至此由 additivity axiom 的推得性質 (d) 

## Conditional Probability

- Conditional probability 為我們提供一種在部分資訊下，對實驗結果進行推理的方法
  - 假設結果落在某個已知事件 $B$ 之內，我們希望量化結果同時屬於另一個給定事件 $A$ 的概似性（likelihood）

- 在一個新的 probability law 之下，定義「給定 $B$ 的 $A$ 的 conditional probability」，記作 $P(A\mid B)$，其定義為
  $$
  P(A\mid B)=\frac{P(A\cap B)}{P(B)}.
  $$
  - 若 $P(B)=0$，則 $P(A\mid B)$ 未被定義
  - 可以把 $P(A\mid B)$ 理解為：在事件 $B$ 的總機率之中，分配給同時也屬於 $A$ 的可能結果所佔的比例

- 當實驗的所有結果等可能時，conditional probability 亦可定義為
  $$
  P(A\mid B)=\frac{\text{number of elements of }A\cap B}{\text{number of elements of }B}.
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
  P(A\mid B)=\frac{P(A\cap B)}{P(B)}\ge 0.
  $$

- Normalization：
  $$
  P(\Omega\mid B)=\frac{P(\Omega\cap B)}{P(B)}=\frac{P(B)}{P(B)}=1.
  $$

- Additivity：若 $A_1$ 與 $A_2$ 為兩個互斥事件，
  $$
  \begin{aligned}
  P(A_1\cup A_2\mid B)
  &=\frac{P\big((A_1\cup A_2)\cap B\big)}{P(B)} \quad \text{(distributive)}\\
  &=\frac{P\big((A_1\cap B)\cup(A_2\cap B)\big)}{P(B)} \quad \text{(disjoint sets)}\\
  &=\frac{P(A_1\cap B)+P(A_2\cap B)}{P(B)}\\
  &=P(A_1\mid B)+P(A_2\mid B).
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
B=\{\text{1st toss is a head}\}.
$$

樣本空間共有八個序列

$$
\Omega=\{\mathrm{HHH},\,\mathrm{HHT},\,\mathrm{HTH},\,\mathrm{HTT},\,\mathrm{THH},\,\mathrm{THT},\,\mathrm{TTH},\,\mathrm{TTT}\},
$$

假設皆等可能。 事件 $B$ 含有四個元素 $\mathrm{HHH},\mathrm{HHT},\mathrm{HTH},\mathrm{HTT}$，因此

$$
P(B)=\frac{4}{8}.
$$

事件 $A\cap B$ 含有三個元素 $\mathrm{HHH},\mathrm{HHT},\mathrm{HTH}$，因此

$$
P(A\cap B)=\frac{3}{8}.
$$

由此

$$
P(A\mid B)=\frac{P(A\cap B)}{P(B)}=\frac{\frac{3}{8}}{\frac{4}{8}}=\frac{3}{4}.
$$

因所有結果等可能，也可用捷徑計算：以 $A$ 與 $B$ 的共同元素個數 $3$ 除以 $B$ 的元素個數 $4$，同樣得到 $3/4$

### Example 1.7

一顆公平 4 面骰擲兩次，假設所有 $16$ 個可能結果等可能。 令 $X,Y$ 分別為第一次與第二次的結果。 欲求 $P(A\mid B)$，其中

$$
A=\{\max(X,Y)=m\},\qquad
B=\{\min(X,Y)=2\},
$$

且 $m$ 取 $1,2,3,4$

結果：

$$
P(\{\max(X,Y)=m\}\mid B)=
\begin{cases}
\dfrac{2}{5}, & m=3\ \text{or}\ 4,\\[6pt]
\dfrac{1}{5}, & m=2,\\[6pt]
0, & m=1.
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
P(SF)+P(FS)=\frac{3}{4}.
$$

再配合 normalization

$$
P(SS)+P(SF)+P(FS)+P(FF)=1,
$$

可解得各結果之機率

$$
P(SS)=\frac{5}{12},\quad
P(SF)=\frac{1}{4},\quad
P(FS)=\frac{1}{12},\quad
P(FF)=\frac{1}{4}.
$$

所求的 conditional probability 為

$$
P\big(\{FS\}\,\big|\,\{SF,FS\}\big)
=\frac{\tfrac{1}{12}}{\tfrac{1}{4}+\tfrac{1}{12}}
=\frac{1}{4}.
$$

## Using Conditional Probability for Modeling

- 在建模時，先指定 conditional probabilities，然後再用它們來決定 unconditional probabilities，這通常既自然又方便
- 一種等價的 conditional probability 定義表法為
  $$
  P(A\cap B)=P(B)\,P(A\mid B).
  $$

### Example 1.9. Radar detection.

如果某區域內確有飛機存在，雷達能以機率 $0.99$ 正確偵測到其存在； 若並不存在，雷達卻會以機率 $0.10$ 誤報有飛機存在。 我們假設飛機存在的先驗機率為 $0.05$。 問：false alarm（錯誤指示飛機存在）的機率，以及 missed detection（實際有飛機但雷達沒有任何顯示）的機率各為何？

![](image/Figure1.8.png)

使用 Fig. 1.8 的序列化樣本空間描述。 設事件

$$
A=\{\text{an aircraft is present}\},\qquad
B=\{\text{the radar registers an aircraft presence}\},
$$
並考慮其補事件
$$
A^{c}=\{\text{an aircraft is not present}\},\qquad
B^{c}=\{\text{the radar does not register an aircraft presence}\}.
$$

則
$$
P(\text{false alarm})=P(A^{c}\cap B)=P(A^{c})P(B\mid A^{c})=0.95\cdot 0.10=0.095,
$$
$$
P(\text{missed detection})=P(A\cap B^{c})=P(A)P(B^{c}\mid A)=0.05\cdot 0.01=0.0005.
$$

## Multiplication (Chain) Rule

- 假設所有作為條件的事件都具有正機率，則有
  $$
  P\!\left(\bigcap_{i=1}^{n}A_{i}\right)
  =P(A_{1})\,P(A_{2}\mid A_{1})\,P(A_{3}\mid A_{1}\cap A_{2})\cdots
  P\!\left(A_{n}\ \middle|\ \bigcap_{i=1}^{n-1}A_{i}\right).
  $$

- 驗證方式可寫成
  $$
  P\!\left(\bigcap_{i=1}^{n}A_{i}\right)
  =P(A_{1})
  \frac{\cancel{P(A_{1}\cap A_{2})}}{P(A_{1})}
  \frac{P(A_{1}\cap A_{2}\cap A_{3})}{\cancel{P(A_{1}\cap A_{2})}}
  \cdots
  \frac{P\!\left(\bigcap_{i=1}^{n}A_{i}\right)}
       {P\!\left(\bigcap_{i=1}^{n-1}A_{i}\right)}.
  $$

- 當 $n=2$ 時，上述乘法法則正是 conditional probability 的定義：
  $$
  P(A_{1}\cap A_{2})=P(A_{1})\,P(A_{2}\mid A_{1}).
  $$

### Example 1.10

從一副標準 $52$ 張撲克牌中不放回抽三張，求三張牌中沒有任何一張是 “heart” 的機率

令 $A_{i}=\{\text{第 }i\text{ 張不是 heart}\}$，$i=1,2,3$。 則
$$
P(A_{1}\cap A_{2}\cap A_{3})
= P(A_{1})\,P(A_{2}\mid A_{1})\,P(A_{3}\mid A_{1}\cap A_{2})
= \frac{39}{52}\cdot\frac{38}{51}\cdot\frac{37}{50}.
$$

### Example 1.11

一個班級有 $4$ 位研究生與 $12$ 位大學生，隨機分成 $4$ 個、每組 $4$ 人的分組。 問：每個小組都恰有一名研究生的機率為何？

定義事件

$$
A_{1}=\{\text{graduate students 1 與 2 在不同小組}\},
$$
$$
A_{2}=\{\text{graduate students 1、2、3 在不同小組}\},
$$
$$
A_{3}=\{\text{graduate students 1、2、3、4 在不同小組}\}.
$$

則

$$
P(A_{3})=P(A_{1}\cap A_{2}\cap A_{3})
= P(A_{1})\,P(A_{2}\mid A_{1})\,P(A_{3}\mid A_{1}\cap A_{2}),
$$

其中

$$
P(A_{1})=\frac{12}{15},\qquad
P(A_{2}\mid A_{1})=\frac{8}{14},\qquad
P(A_{3}\mid A_{1}\cap A_{2})=\frac{4}{13}.
$$

因此

$$
P(A_{3})=\frac{12}{15}\cdot\frac{8}{14}\cdot\frac{4}{13}.
$$

## Total Probability Theorem

設 $A_{1},\dots,A_{n}$ 為將樣本空間分割（partition）的一組互斥事件，且假設對所有 $i$ 均有 $P(A_{i})>0$。 則對任意事件 $B$，有

$$
P(B)=P(A_{1}\cap B)+\cdots+P(A_{n}\cap B)
=P(A_{1})P(B\mid A_{1})+\cdots+P(A_{n})P(B\mid A_{n}).
$$

注意：實驗（樣本空間）的每一個可能結果，恰好屬於事件 $A_{1},\dots,A_{n}$ 的其中之一

![](image/Figure1.12.png)

上圖以視覺化方式驗證 Total Probability Theorem。 事件 $A_{1},\dots,A_{n}$ 形成一個樣本空間的分割，因此事件 $B$ 可以分解為它與各 $A_{i}$ 的交集的不相交聯集，即

$$
B=(A_{1}\cap B)\ \cup\ \cdots\ \cup\ (A_{n}\cap B).
$$

由 additivity axiom 可得

$$
P(B)=P(A_{1}\cap B)+\cdots+P(A_{n}\cap B).
$$

又由 conditional probability 的定義

$$
P(A_{i}\cap B)=P(A_{i})\,P(B\mid A_{i}),
$$

代入上式得到

$$
P(B)=P(A_{1})P(B\mid A_{1})+\cdots+P(A_{n})P(B\mid A_{n}).
$$

### Example 1.13

你參加一場西洋棋賽。 對於一半的選手（type 1），你贏一局的機率是 $0.3$； 對於四分之一的選手（type 2），機率是 $0.4$； 對於剩下四分之一的選手（type 3），機率是 $0.5$。 你將與隨機選中的對手對弈。 問：贏棋的機率是多少？

令 $A_i$ 表示「對手是 type $i$」的事件，則

$$
P(A_1)=0.5,\qquad P(A_2)=0.25,\qquad P(A_3)=0.25.
$$

再令 $B$ 為「我贏棋」的事件，則

$$
P(B\mid A_1)=0.3,\qquad P(B\mid A_2)=0.4,\qquad P(B\mid A_3)=0.5.
$$

因此由 Total Probability Theorem，

$$
\begin{aligned}
P(B)
&=P(A_1)P(B\mid A_1)+P(A_2)P(B\mid A_2)+P(A_3)P(B\mid A_3)\\
&=0.5\cdot 0.3+0.25\cdot 0.4+0.25\cdot 0.5\\
&=0.375.
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
P(B\mid A_4)=1.
$$

由 Total Probability Theorem，

$$
\begin{aligned}
P(B)
&=\frac14\cdot\frac12+\frac14\cdot\frac34+\frac14\cdot 0+\frac14\cdot 1\\
&=\frac{9}{16}.
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
P(B_2)&=P(U_1)P(B_2\mid U_1)+P(B_1)P(B_2\mid B_1)=P(U_1)\cdot 0.2+P(B_1)\cdot 0.6.
\end{aligned}
$$

由於 $P(U_1)=0.8,\ P(B_1)=0.2$（$P(U_0)=1$），得

$$
P(U_2)=0.8\cdot 0.8+0.2\cdot 0.4=0.72,\qquad
P(B_2)=0.8\cdot 0.2+0.2\cdot 0.6=0.28,
$$

故

$$
P(U_3)=0.72\cdot 0.8+0.28\cdot 0.4=0.688.
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

- 由 Thomas Bayes（約 1701–1761，Presbyterian minister）提出； “Bayes’ theorem” 在其身後發表
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
       {P(A_1)P(B\mid A_1)+P(A_2)P(B\mid A_2)+P(A_3)P(B\mid A_3)},
\quad i=1,2,3.
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
&=0.0187.
\end{aligned}
$$
