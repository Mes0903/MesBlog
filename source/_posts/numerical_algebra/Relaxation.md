---
title: Relaxation Method
date: 2021/10/16
mathjax: true
abstract: 數值線代的上課筆記，講的 Relaxation Method，老實說我已經忘光了
tags: numerical_algebra
categories:
- numerical_algebra
---

# 7.4 Relaxation Method

## Relaxation method

這個方法顧名思義就是把原本的方法做一點放鬆，他的概念用到外插法 (extrapolate) 來產生他迭代的方法，像這樣：

![](https://i.imgur.com/BWFNpg1.png)

畫成圖形可以像這樣：

![](https://i.imgur.com/Mz4MIBe.png)

利用上一次的 $x^{(k-1)}$ 的資訊與透過某種方式獲得的向量 $x^*$ 來取得這一次的 $x^k$

而怎麼取得呢，簡單來說就是給個權重 w，然後 $x^{(k-1)}$ 乘上 1-w，$x^*$ 乘上 w。

w 是一個實數，而 $x^*$ 其實是個中間迭代出來的解，不管是用 Jacobi 還是 Gauss-Seidel 都可以，那我們這邊用 Gauss-Seidel 來舉例，也就是說：

![](https://i.imgur.com/jPsPwkq.png)

你把 $x^*$ 的 `*` 改成 k 就完全是 Gauss-Seidel 的通式了。

所以我們只要通過上一步迭代的解跟某一個方法得到的中間解做一個線性組合，就可以當作我們這個 Relaxation Method 的新的解。

那 w 的選擇有兩種：

![](https://i.imgur.com/cofiFDY.png)

我們原本考慮的問題如果用 Gauss-Seidel 方法，不會收斂的話，這時候我們就可以考慮用 under-relaxation method。 而一個迭代法會不收斂就代表這個問題的迭代矩陣的譜半徑大於 1。

而如果我們原本 Gauss-Seidel 的方法就會收斂，那我們就可以利用上圖中下面那個 over-relaxation methods 來幫助我們加速收斂。

加速收斂就代表我們迭代的解更快的靠近真實的解，我們先寫成這樣：

![](https://i.imgur.com/fTfOcsJ.png)

T 是這個問題的迭代矩陣，c 是一個跟 k 無關的向量。

而如果這個迭代法會收斂，就會滿足這個式子：

![](https://i.imgur.com/3oJaQKx.png)

注意 T 的譜半徑會小於 1，因為收斂。

那我們讓這兩式相減，會長這樣(紅色部分)：

![](https://i.imgur.com/cxspOPn.png)

那一樣像上次那樣寫成 D、L、U 的形式

![](https://i.imgur.com/56FmM5d.png)

可以看見我們一樣要解一個下三角矩陣的問題，那也一樣可以用 forward substitution 來快速解這個問題