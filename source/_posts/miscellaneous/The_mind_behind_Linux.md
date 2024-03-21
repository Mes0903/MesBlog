---
title: The mind behind Linux 筆記 & 心得
date: 2021/12/15
tags: miscellaneous
categories:
- miscellaneous
---

# The mind behind Linux 筆記 & 心得

## 前言

Linus Torvalds 在 2016 年的 [TED interview](https://www.ted.com/talks/linus_torvalds_the_mind_behind_linux) 裡談到了他自己的工作模式，性格與 Linux 和 Git 出現時的一些心路歷程。

於 14:10 分時他提到了 coding 方面的 「good taste」 是什麼，並舉了一個 singly-linked list 的例子，由於在社團裡看見有人說看不懂，加上自己也想做一下筆記，因此就寫了這篇，並補了一些說明及例子，實作上主要參考了 [felipec](https://github.com/felipec/linked-list-good-taste) 的 github 與 [Jserv 老師的解釋](https://hackmd.io/@sysprog/c-linked-list)。

若文章內容有謬誤，或您有什麼建議，都很歡迎私訊告訴我~

## 概念

Linus Torvalds 舉的例子是移除一筆在 list 裡面的資料，一般的寫法會有 special case，第一筆資料與中間的資料的移除方法有點不太一樣。

如果要移除的是第一筆資料，那就需要把指標指向第一個 Node；而如果是要移除中間的資料，則須要把指標指向目標的前一個 Node。

Talk 裡面給的 Pseudo Code 長這樣：
```cpp=
remove_list_entry(entry)
{
    prev = NULL;
    walk = head;

    // Walk the list

    while (walk != entry) {
        prev = walk;
        walk = walk->next;
    }

    // Remove the entry by updating the
    // head pr the previous entry

    if (!prev)
        head = entry->next;
    else
        prev->next = entry->next;
}
```

而 Linus Torvalds 的想法則換了一個角度，通過指標的指標來操作，如此一來 branch 就消失了。

Talk 裡面給的 Pseudo Code 長這樣：
```cpp=
remove_list_entry(entry)
{
    // The "indirect" pointer points to the
    // *address* of the thing we'll update

    indirect = &head;

    // Walk the list, looking for the thing that
    // points to the entry we want to remove

    while ((*indirect) != entry)
        indirect = &(*indirect)->next;

    // .. and just remove it

    *indirect = entry->next;
}

```

如果 Pseudo Code 有點難看，那你可以先跳過，往後看解釋和簡單的實作。

## 解釋

Linus Torvalds 在 15:25 時說

>  It does not have the if statement. And it doesn't really matter -- I don't want you understand why it doesn't have the if statement, but I want you to understand that sometimes you can see a problem in a different way and rewrite it so that a special case goes away and becomes the normal case. And that's good code. But this is simple code. This is CS 101. This is not important -- although, details are important. 

重點是有時候我們可以從不同的角度來詮釋問題，然後重寫，那麼例外就會消失，這樣就是好的程式。

第一種一般的方法大家應該很熟悉，有一個指向前一個元素的指標，一個目前位置的指標，之後利用 while loop 來走訪 list，找到 target 時停下來。

然後會有一個 branch 判斷 `prev` 是否為空指標，如果是空指標就代表 target 是 list 的 head，因此需要把 list 的 head 指向下一個元素；若非空就把前一個元素的 next Node 設為目前的下一個 Node：

![](https://i.imgur.com/0EHTGG0.png)

而 Linus Torvalds 的想法則是拿一個指標指向「Node 裡面指向下一個 Node 的指標」，以「要更新的位址」為思考點來操作。

有一個指標的指標 `indirect`，一開始指向 head，之後一樣走訪 list，解指標看是不是我們要的 target，如果 `*indirect` 就是我們要刪除的元素，代表 `indirect` 現在指向前一個 Node 裡面的 next pointer，因此把 `*indirect` 設為 target 的下一個 Node 就完成整個操作了：

![](https://i.imgur.com/OopvzWM.png)

## 簡單的實作

這邊我先用 C 來實作，參考了 [felipec](https://github.com/felipec/linked-list-good-taste) 的寫法，下面這些 code 的 github [在這](https://github.com/Mes0903/Mes_Note/blob/main/The_mind_behind_Linux_Note/Elegant_Linked_List.c)。

### struct 定義

首先先把 `Node` 與 `List` 的 struct 寫好：

```c=
typedef struct Node {
    int data;
    struct Node *next;
} Node;

typedef struct List {
    Node *head;
} List;
```

### find

再來是一個幫忙尋找目標 Node 的函式，後面會透過這個 function 來幫助我們實作別的函式：

```c=
Node **find(List *list, Node *target)
{
    Node **indirect = &list->head;
    while (*indirect && *indirect != target)
        indirect = &(*indirect)->next;

    return indirect;
}
```

在尋找時會有兩種 special case：
1. List 是空的
2. Node 不在 List 裡

這個函式會回傳 target 的 indirect pointer，也就是指 `*indirect == target`。

函式裡的 indirect pointer，一開始指向 head，然後走訪 List 尋找 target，一但找到，或是已經沒有下一個時就停止迴圈，並回傳 indirect pointer。

而如果元素不在 List 裡面，則會回傳指向最後一個 Node 的 next 指標的指標，也就是 `&Node->next`，同時也是指 `*indirect == NULL`。

### erase

接下來就是刪除 Node 的函式：

```c=
void erase(List *list, Node *target)
{
    Node **indirect = find(list, target);

    if (*indirect)
        *indirect = target->next;
}
```

刪除時如果 Node 不在 List 裡面，或者 List 是空的，那麼 find 就會回傳 `NULL`，因此我們會需要一個 `if` 來判斷是不是這些 special case，如果不是，就刪除 Node。

這邊並沒有去 call `free`，如果要呼叫 `free`，那就要再改一下寫法了。

### insert_before

然後是插入 Node 的函式：

```c=
void insert_before(List *list, Node *target, Node *item)
{
    Node **indirect = find(list, target);

    item->next = *indirect;
    *indirect = item;
}
```

我們會傳入一個 target，並把 Node 插入於 target 的前方。

插入的方法是先把要插入的 Node 的 next 指向 target，再把原本指向 target 的指標指向 item。

特別的是如果 target 是傳 `NULL` 或一些非法、不在 List 裡面的指標進去，那麼元素會被加到 List 的最後面，因為如果 target 不在 List 裡面，`find` 回傳的會是最後一個元素的 next 指標的位址。

### output

最後就是把整個 List 輸出的函式：

```c=
void output(List *list)
{
    Node **indirect = &list->head;

    while (*indirect) {
        printf("%d ", (*indirect)->data);
        indirect = &(*indirect)->next;
    }
}
```

這個就跟一般的走訪輸出差不多，但因為是用 indirect pointer 實作，所以不用再去看 List 是否為空，變得非常漂亮優雅。

### main function

main function 裡面我寫了簡單的測試：

```c=
int main()
{
    Node items[N];
    List list;

    // initialize items and head pointer
    for (size_t i = 0; i < N; ++i) {
        items[i].data = i;
        items[i].next = NULL;
    }
    list.head = NULL;

    erase(&list, &items[0]);    // delete when list is empty

    // insert element from head pointer
    for (size_t i = 0; i < N; i++)
        insert_before(&list, &items[6], &items[i]);

    erase(&list, &items[5]);    // normal delete element

    erase(&list, &items[5]);    // delete element which is not in list
    erase(&list, list.head);    // delete the head node

    output(&list);
}
```

`items` 是所有的 Node，這裡用 array 存起來方便我們測試。

## Cpp 實作

我也用 Cpp 寫了一次，有兩種版本，一種是傳統 Raw Pointer 的版本，另一種是 Smart Pointer 的版本：

+ Raw Pointer Edition：[github link](https://github.com/Mes0903/Mes_Note/blob/main/The_mind_behind_Linux_Note/Elegant_Linked_List.cpp)

+ Smart Pointer Edition：[github link](https://github.com/Mes0903/Mes_Note/blob/main/The_mind_behind_Linux_Note/Modern_Elegant_Linked_List.cpp)

整體的設計概念都一樣，但我有做一些小調整，讓使用的時候可以直接傳 `data` 進 user API，還有多處理了記憶體釋放的問題。

# 延伸閱讀

看到這裡後建議可以去看一下 Jserv 老師提到的 [Merge Two Sorted Lists](https://hackmd.io/@sysprog/c-linked-list?fbclid=IwAR2dELWav-gGwBZHOnXBDnpywQQhEUtMcYdLPRKum99rdiz8QsVqrhYpKCM#%E6%A1%88%E4%BE%8B%E6%8E%A2%E8%A8%8E-LeetCode-21-Merge-Two-Sorted-Lists) 這個案例，題目連結在這裡：[LeetCode 21. Merge Two Sorted Lists](https://leetcode.com/problems/merge-two-sorted-lists/)

題目是給兩個已經排序好的 linked list，然後把他們 merge 起來，元素的順序要一樣由小到大或由大到小，實作上可以利用 indirect pointer 來省一些空間。

而如果你還有接著讀老師文章後方 [LeetCode 23. Merge k Sorted Lists](https://leetcode.com/problems/merge-k-sorted-lists/) 的例子，那可以去看一下 Lambert Wu 寫的 [Merge Sort 與它的變化](https://hackmd.io/@nk8mC3QoR3yxmNf5DvbQXw/modified-merge-sort)，裡面有多做一些解釋且有測試不同方法的速度。

