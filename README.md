# Kredyty RM

PWA współpracy z doradcą kredytowym (Natalia), zbudowana 19.11.2026. Zastępuje zakładkę Kredyty z Zadań RM (usunięta w Zadaniach v44) i Excel `3. Klienci Natalii - Doradca Kredytowy.xlsx`.

- **🤝 Klienci:** kolumny jak w Excelu: data umowy, od kogo (Biuro = od RM dla Natalii, Natalia = od Natalii dla RM), klient, telefon, nieruchomość, zdolność sprawdzona (Tak/Nie), kredyt otrzymany (W trakcie/Tak/Nie/Bez kredytu), kwota kredytu, zamknięcie sprzedaży (data = karta zielona, pusta = w toku), notatka. Filtry W toku/Zamknięte/Wszyscy i od kogo, szukajka, kafle (w toku, zamknięte w roku, suma kredytów, dla RM od Natalii).
- **Rozliczenie (szacunek wg maila do Natalii z 20.10.2026, umowa niepodpisana):** klient od RM: grupa A (transakcja RM) 1%, grupa B (marka RM: reklama, telefon, strona) 0,8% kwoty kredytu brutto dla RM. Klient od Natalii: 10% prowizji RM netto dla Natalii po zamknięciu. Stawki w stałych `STAWKA` i `DLA_NATALII` w app.js.
- **📣 Kampanie:** reklamy na kredyt: nazwa, status (Plan/Aktywna/Zakończona), miejsca (kilka, plus własne), od-do, budżet, ile zapytań (koszt zapytania liczy się sam), link, notatka, zdjęcia reklamy (prywatny bucket `kredyty-kampanie`, zmniejszane do 1800 px, link ważny 1 h, podgląd po kliknięciu).

Dostęp (RLS w `setup.sql`): klientów widzi i zmienia menedżer, asystentka i doradca; agent dopisuje i widzi tylko swoich; usuwa menedżer. Kampanie widzi cały zespół, prowadzi menedżer/asystentka/doradca, usuwa menedżer.

Dane w bazie Zadań RM (Supabase `zadania-rm`), to samo logowanie. Natalia potrzebuje konta (Supabase > Authentication > Add user, Auto Confirm) z rolą „Doradca kredytowy” (Zadania > Ustawienia > Zespół). Stara tabela `kredyty` z Zadań zostaje w bazie nieużywana.
Tryb próbny: `index.html?proba` (przykłady nieprawdziwe). Nazwisk klientów nie wpisujemy do repo, tylko w aplikacji.
Wydanie: podbij `WERSJA` w app.js, `?v=` w index.html i `CACHE` w sw.js, potem `bash publikuj.sh "opis"`.
