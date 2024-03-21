---
title: Power Method
date: 2021/11/15
tags: numerical_algebra
categories:
- numerical_algebra
---

# 9.3 Power Method

### Example

看一下費波那契數列 $F_n = F_{n-1} + F_{n-2}$，這個數列長 $\{0,1,1,2,3,5,8,13,21,34,\ ...\}$，我們可以透過矩陣來重寫這個數列：

![](https://i.imgur.com/n8vuFLK.jpg)

在這個例子裏面，我們觀察到 eigenvector、eigenvalue 跟長期的外顯行為有關。

### Example

看第二個例子，假設這邊有四個網頁，然後我們常像這樣去瀏覽她：

![](https://i.imgur.com/0g3hyZK.png)

那麼就會有一個機率矩陣：

![](https://i.imgur.com/nd4Ea30.png)

### Thm dominant eigenvalue

![](https://i.imgur.com/SFskHSJ.jpg)

### Prop Power Method

假設 $A \in \mathbb{R}^{n \times n}$ 有 dominant eigenvalue。 給定 initial guess $\vec x$ 且製造一個數列長這樣：

![](https://i.imgur.com/UcPyOhl.png)

我們希望這個數列能很好的幫助我們去逼近 dominant eigenvalue。

### Example 

![](https://i.imgur.com/8is5Gkb.jpg)

這裡我們可以看到 Power Method 會產生一個很大的數字在矩陣前方，這個數字可以透過歸一化之類的方法來消除掉，我們這邊透過 scale down 的方法來做一次，在每步迭代前都先除上自己 norm：

![](https://i.imgur.com/HFMeChb.jpg)

### Thm dominant eigenvalue

![](https://i.imgur.com/dJvzqYR.jpg)

證明：

![](https://i.imgur.com/ztsMyRi.jpg)






