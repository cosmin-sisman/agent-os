{{! area: docs }}
# Standarde de cod

Se aplica la fiecare schimbare, indiferent de limba din chat. Regulile pe limbaj sunt in `.claude/rules/stack/` si se incarca pentru caile lor.

## Mereu

- **Engleza in cod**: identificatori, comentarii, docstring-uri, mesaje de log si mesaje de commit{{#if lang.codeComments == "ro"}}; echipa permite comentarii in romana fara diacritice{{/if}}.
- **Fiecare fisier incepe cu un antet de 1-3 randuri**: ce este si unde se incadreaza. Functiile si tipurile publice isi documenteaza contractul; comentariile explica *de ce*, nu *ce*.
- **Functii mici, cu un singur scop**, nume din domeniu, tratare consecventa a erorilor. Fara cod mort, fara logica duplicata, fara `TODO` fara referinta la un issue (`TODO(#123)`).
- **Cea mai simpla solutie corecta.** Optimizeaza ce e masurat sau evident fierbinte (I/O in bucle, interogari N+1, memorie nelimitata). Nu schimba claritatea pe viteza fara un motiv scris langa cod.
- **Testele vin cu schimbarea**: scenariile din issue devin teste in acelasi {{vocab.changeRequest}}. Un fix de bug incepe cu testul care pica fara el.

## Alegerea intre solutii

Cand exista mai multe variante rezonabile:
1. numeste doua sau trei, cate un rand fiecare;
2. compara-le dupa corectitudine, simplitate, potrivire cu codul si stack-ul existent, performanta unde conteaza, testabilitate si costul schimbarii;
3. alege una si spune de ce, intr-o propozitie. O alegere netriviala sau greu de inversat intra intr-o decizie (`agent-os decision new`) sau in jurnal;
4. implementeaza doar varianta aleasa, niciodata doua jumatati.

## Date si configurare

- **Pune identificatorii intre ghilimele in YAML si alte formate slab tipizate**: culori (`"000000"`), versiuni (`"1.10"`), id-uri si coduri postale sunt siruri. Fara ghilimele devin numere. Codul care le citeste le converteste oricum defensiv.
- **Fisierele text sunt LF.** Tot ce inregistreaza hash-uri de continut se strica la checkout-uri care convertesc capetele de rand.
