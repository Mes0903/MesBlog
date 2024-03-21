---
title: 作業系統 ── 序
date: 2021/12/10
abstract: 周志遠老師的 OS 筆記，由於當初讀完沒寫，所以是專門為了教人而回來寫的，因此算是有生之年系列
tags: OS
categories:
- OS
---

# 作業系統 ── 序

# 前言 

這裡是我讀作業系統的筆記，修的是清大周志遠老師的作業系統。

課程網址：[10501 資訊工程學系 作業系統](https://ocw.nthu.edu.tw/ocw/index.php?page=course&cid=141&)

影片 YT 連結：[【10510周志遠教授：作業系統】](https://www.youtube.com/playlist?list=PLS0SUwlYe8czigQPzgJTH2rJtwm0LXvDX)

課本：[Operating System Concepts, 9th Edition, International Student Version](https://www.wiley.com/en-sg/Operating+System+Concepts%2C+9th+Edition%2C+International+Student+Version-p-9781118093757)

課堂講義：[【周志遠教授作業系統講義】](https://ocw.nthu.edu.tw/ocw/index.php?page=course_news_content&cid=141&id=999)

如果我有另外補充什麼，參考資料都會列在文章下方。

然後這邊推一下 Jserv 的兩篇回文：

<a href = "https://disp.cc/b/163-baku" class = "wheatlink">1. [問卦] 作業系統是不是理科最簡單科目</a>

<a href = "" class = "wheatlink">2. [問卦] 精通數位邏輯對Coding有什麼幫助？</a>

雖然我自己非常喜歡作業系統與編譯器，但可能有很多人不知道自己學這些東西要幹嘛，我認為這兩篇回覆很值得讀一下，長度也挺剛好的。

再來是一些其他的資源：

<a href = "https://hackmd.io/@Pl-eQT9CQaS0jhExKqL8_w/BkhOSR4jW/https%3A%2F%2Fhackmd.io%2Fs%2FS14A_CVjW?type=book" class = "wheatlink">1. 陳品媛整理的筆記</a>

<a href = "https://mropengate.blogspot.com/search/label/Computer%20Science-Operating%20System" class = "wheatlink">2. Mr. Opengate 整理的筆記</a>

<a href = "https://www.youtube.com/playlist?list=PL6S9AqLQkFpongEA75M15_BlQBC9rTdd8" class = "wheatlink">3. Linux 核心設計影片</a>、<a href = "http://hackfoldr.org/linux/" class = "wheatlink">講義</a> 

<a href = "https://github.com/sysprog21/lkmpg" class = "wheatlink">4. The Linux Kernel Module Programming Guide</a>

<a href = "" class = "wheatlink"></a>

<a href = "" class = "wheatlink"></a>

下面是我的自我介紹，基本上是從 C++ Miner 那邊複製過來的了，如果你有興趣也可以逛一下。

# 關於我

我是 Mes，一個喜愛 C++ 的人，寫文的現在(2021/04/02) 就讀中央大學數學系，目前大一，~~成績很差，盡量不要問我數學~~，如果想一起討論程式問題的話可以加我的 Discord、FB 或 IG，我主要用這三個，程式方面的討論我主要都在 Discord 找人問和回答問題：

<br>

$\quad$ <img src = "https://i.imgur.com/8VxLB4u.png" height = 50>：Mes#0903 $\quad\quad$ <img src = "https://i.imgur.com/ZhnN1X5.png" height = 50> ：<strong><a href = "https://www.facebook.com/Mes0903/" class = "wheatlink">鄭詠澤</a></strong> $\quad\quad$ <img src = "https://i.imgur.com/u58NApS.png" height = 50> ： <strong><a href = "https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.instagram.com%2Fmes__0903%2F%3Ffbclid%3DIwAR1iQsB_Ut0plLcoX-23ElqMMhco5Rago-OQt1sm_mXf1TXfrACATwDzc9Y&h=AT2N8fONSla4y7H3oQyKVjSt5nbKOQIJlkoamDlDLoRvRNrRkmjsqyUbxkOrpsedsfd3ZMWq3a-4Rrw2-MVSJS1NtrnusXXX9ZIBCcVxKS2Lf6VefzlVrBr7ZKlwf63e79Ankw" class = "wheatlink">mes__0903</a></strong> $\quad\quad$ <img src = "https://i.imgur.com/CENNQ24.png" height = 50> ： <strong><a href = "https://www.youtube.com/channel/UCT3MbveOznWLlxNIdLUUOhg" class = "wheatlink">Mes</a></strong>

<br>

興趣是寫作、看畫、Compiler、OS、C++、Assembly，偶爾會去攝影，會在 IG 上寫雜記和分享家裡的貓咪照片，FB 版上全是分享別人動物的貼文，~~愜意的生活~~。

<br>

# 一些資源

下面這些是我可能會出現的 Discord 群，我通常會在這些群裡面回答問題或問問題：
<br>

+ <strong><a href = "https://discord.gg/programming" class = "wheatlink">The Programmer's Hangout</a></strong>

+ <strong><a href = "https://discord.gg/nRafgDK8fB" class = "wheatlink">Better C++</a></strong>

+ <strong><a href = "https://discord.gg/J5hBe8F" class = "wheatlink">C++ Help</a></strong>

+ <strong><a href = "https://discord.gg/7zfsaTnpbT" class = "wheatlink">Together C & C++</a></strong>

+ <strong><a href = "https://discord.gg/ypvyFDugM8" class = "wheatlink">中學資訊討論群</a></strong>

<br>

如果有哪個連結失效了還請留言或私訊告訴我，我都選了永久的，應該是不會失效才對XD 我非常建議大家加入 Discord 群組討論，Telegram 據我所知還沒有這麼多的群組，而 Discord 有一個優點就是資訊流通的速度非常快，你問完問題馬上就會有人回答了，如果不懂你能馬上再回問她，相較於 FB 社團，甚至是 Email 問外國演講者、作者問題之類的，速度會快上許多。

<br>

雖然自己思考問題是很好的進步方式，這樣的方式能讓你的思緒更清晰，對事情和原理的理解也會更透徹，但若到了一定階段你還沒思考出來，最好還是找一些人問一下會比較好，別人可能會從你從沒想過的角度來解釋問題，讓你豁然開朗。

---

再來是一些 C++ 的文件：

<strong>

<span class = "burlywood">C/C++ Language References (final/current working drafts)</span>

+ <img src = "https://i.imgur.com/g7fxJnW.png" height = 30>  C89： (沒有 PDF 版本) 、 <a href = "http://port70.net/~nsz/c/c89/c89-draft.html" class = "wheatlink">HTML</a>

+ <img src = "https://i.imgur.com/g7fxJnW.png" height = 30> C99 (N1256)： <a href = "http://port70.net/~nsz/c/c99/n1256.pdf" class = "wheatlink">PDF</a> 、 <a href = "http://port70.net/~nsz/c/c99/n1256.html" class = "wheatlink">HTML</a>

+ <img src = "https://i.imgur.com/g7fxJnW.png" height = 30> C11 (N1570)： <a href = "http://port70.net/~nsz/c/c11/n1570.pdf" class = "wheatlink">PDF</a> 、 <a href = "http://port70.net/~nsz/c/c11/n1570.html" class = "wheatlink">HTML</a>

+ <img src = "https://i.imgur.com/g7fxJnW.png" height = 30> C17 (N2176)： <a href = "https://files.lhmouse.com/standards/ISO%20C%20N2176.pdf" class = "wheatlink">PDF</a> 、 (沒有 HTML 版本)

+ <img src = "https://i.imgur.com/g7fxJnW.png" height = 30> C23： <a href = "http://www.open-std.org/jtc1/sc22/wg14/www/docs/n2596.pdf" class = "wheatlink">PDF</a> 、 (沒有 HTML 版本)

+ <img src = "https://i.imgur.com/OUNNxrC.png" height = 30> C++ 11 (N3337)： <a href = "http://open-std.org/jtc1/sc22/wg21/docs/papers/2012/n3337.pdf" class = "wheatlink">PDF</a> 、 <a href = "https://timsong-cpp.github.io/cppwp/n3337/" class = "wheatlink">HTML</a>

+ <img src = "https://i.imgur.com/OUNNxrC.png" height = 30> C++ 14 (N4140)： <a href = "https://timsong-cpp.github.io/cppwp/n4140/draft.pdf" class = "wheatlink">PDF</a> 、 <a href = "https://timsong-cpp.github.io/cppwp/n4140/" class = "wheatlink">HTML</a>

+ <img src = "https://i.imgur.com/OUNNxrC.png" height = 30> C++ 17 (N4659)： <a href = "http://open-std.org/jtc1/sc22/wg21/docs/papers/2017/n4659.pdf" class = "wheatlink">PDF</a> 、 <a href = "https://timsong-cpp.github.io/cppwp/n4659/" class = "wheatlink">HTML</a>

+ <img src = "https://i.imgur.com/OUNNxrC.png" height = 30> C++ 20 (N4861)： <a href = "http://open-std.org/jtc1/sc22/wg21/docs/papers/2020/n4861.pdf" class = "wheatlink">PDF</a> 、 <a href = "https://timsong-cpp.github.io/cppwp/n4861/" class = "wheatlink">HTML</a>

+ <img src = "https://i.imgur.com/OUNNxrC.png" height = 30> C++ 23 (N4885)： <a href = "http://open-std.org/JTC1/SC22/WG21/docs/papers/2021/n4885.pdf" class = "wheatlink">PDF</a> 、 <a href = "https://eel.is/c++draft/" class = "wheatlink">HTML</a>

</strong>

你可以在 <a href = "https://en.cppreference.com/w/cpp/links" class = "wheatlink">Cppreference</a> 看到這些資訊，我的閱讀方式是 Drafts 配 Cppreference 來看，然後上網找例子或自己想一些例子來驗證，如果有不懂的就會到 Google 和 Stackoverflow 搜尋，有時候 CSDN 也會有答案，但就如我前面所說的，比較新的東西通常中文資源很少，不太會有什麼文章。不過據我所知，Drafts 這樣密密麻麻的英文字對許多人來說並不是很友善，所以我的方法可能並不適合你，希望你可以找到自己的方法。

<br>

那如果一直找不到 (可能是比較深或偏向英文方面意思理解有困難等等)，那我就會到 Discord 群裡面發問，發問的方式可以參考 <strong><a href = "https://github.com/ryanhanwu/How-To-Ask-Questions-The-Smart-Way" class = "wheatlink">How To Ask Questions The Smart Way</a></strong>，總之不要問那些一到 Google 就馬上可以找到的問題，如果你問完問題別人馬上丟了一個解答的網址給你，你應該要檢討一下XD 

---

再來是一些不錯的頻道：

<strong>

+ <a href = "https://www.youtube.com/channel/UCQ-W1KE9EYfdxhL6S4twUNw" class = "wheatlink">The Cherno</a> (親民)

+ <a href = "https://www.youtube.com/channel/UCNge3iECU0XKjshac_hdejw" class = "wheatlink">Italian Cpp Community</a>

+ <a href = "https://www.youtube.com/channel/UCIm-u7l65hp5jboSJrB7U5w" class = "wheatlink">. GUTS</a> (jserv)

+ <a href = "https://www.youtube.com/channel/UCYO_jab_esuFRV4b17AJtAw" class = "wheatlink">3Blue1Brown</a> (有點像科普)

+ <a href = "https://www.youtube.com/user/CppCon/videos" class = "wheatlink">CppCon</a> (非常推薦這個，有很多大佬會分享東西)

+ <a href = "https://www.youtube.com/channel/UCxHAlbZQNFU2LgEtiqd2Maw" class = "wheatlink">Cᐩᐩ Weekly With Jason Turner</a> (這個很猛)

</strong>

---

最後是這篇的 CSS 在這裡：https://hackmd.io/aPqG0f7uS3CSdeXvHSYQKQ?both

<br>

如果你需要可以拿去，我寫蠻久的 XD，一開始是從官網上找到黑色模板的，然後隨著時間慢慢就變成自己的版本了，你可以把它複製下來改成自己的版本。

<br>

前言差不多就這樣啦，我是 Mes，一個喜愛 C++ 的人，主推 ina (x。

<center><img src = "https://i.imgur.com/SLfT4YJ.png" height = 400></center>



