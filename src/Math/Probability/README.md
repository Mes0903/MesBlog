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

- Example 1.5：Romeo 與 Juliet 約好在某個時間見面，兩人到達會合地點的延遲時間皆在 $0$ 到 $1$ 小時之間，且所有延遲時間的組合等可能。先到的人會等 $15$ 分鐘，若對方仍未到就離開。問：他們會相遇的機率是多少？
  
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

