export type TeleportCopy = {
  title: string;
  body: string;
  continue: string;
  payInApp: string;
  cancel: string;
};

export type TeleportSuccessCopy = {
  title: string;
  body: string;
  bodyNoReturn: string;
  bodyPaidElsewhere: string;
  action: string;
  poweredBy: string;
};

type LocaleCopy = {
  dir?: "rtl";
  waiting: TeleportCopy;
  success: TeleportSuccessCopy;
};

const COPY = {
  en: {
    waiting: {
      title: "Finish in your browser",
      body: "Complete your purchase there and you'll get access here automatically.",
      continue: "Complete in Browser",
      payInApp: "Continue In-App Instead",
      cancel: "Cancel",
    },
    success: {
      title: "You're all set",
      body: "Your purchase is complete.",
      bodyNoReturn: "You can go back to the app now.",
      bodyPaidElsewhere:
        "You already bought this in another checkout, so you weren't charged again.",
      action: "Return to App",
      poweredBy: "Powered by Superwall",
    },
  },
  es: {
    waiting: {
      title: "Termina en tu navegador",
      body: "Completa la compra allí y tendrás acceso aquí automáticamente.",
      continue: "Completar en el navegador",
      payInApp: "Continuar en la app",
      cancel: "Cancelar",
    },
    success: {
      title: "Todo listo",
      body: "Tu compra se completó.",
      bodyNoReturn: "Ya puedes volver a la app.",
      bodyPaidElsewhere: "Ya lo compraste en otro pago, así que no se te cobró de nuevo.",
      action: "Volver a la app",
      poweredBy: "Impulsado por Superwall",
    },
  },
  fr: {
    waiting: {
      title: "Terminez dans votre navigateur",
      body: "Finalisez votre achat là-bas et vous aurez accès ici automatiquement.",
      continue: "Terminer dans le navigateur",
      payInApp: "Continuer dans l'app",
      cancel: "Annuler",
    },
    success: {
      title: "C'est fait",
      body: "Votre achat est terminé.",
      bodyNoReturn: "Vous pouvez retourner dans l'app.",
      bodyPaidElsewhere:
        "Vous l'avez déjà acheté lors d'un autre paiement, aucun montant n'a donc été débité à nouveau.",
      action: "Retour à l'app",
      poweredBy: "Propulsé par Superwall",
    },
  },
  de: {
    waiting: {
      title: "Im Browser abschließen",
      body: "Schließe den Kauf dort ab – danach hast du hier automatisch Zugriff.",
      continue: "Im Browser fertigstellen",
      payInApp: "Stattdessen in der App fortfahren",
      cancel: "Abbrechen",
    },
    success: {
      title: "Fertig",
      body: "Dein Kauf ist abgeschlossen.",
      bodyNoReturn: "Du kannst jetzt zur App zurückkehren.",
      bodyPaidElsewhere:
        "Du hast das bereits in einem anderen Checkout gekauft, daher wurde dir nichts erneut berechnet.",
      action: "Zurück zur App",
      poweredBy: "Powered by Superwall",
    },
  },
  it: {
    waiting: {
      title: "Completa nel browser",
      body: "Completa l'acquisto lì e avrai accesso qui automaticamente.",
      continue: "Termina nel browser",
      payInApp: "Continua nell'app",
      cancel: "Annulla",
    },
    success: {
      title: "Tutto pronto",
      body: "L'acquisto è completato.",
      bodyNoReturn: "Ora puoi tornare all'app.",
      bodyPaidElsewhere:
        "L'hai già acquistato in un altro pagamento, quindi non ti è stato addebitato di nuovo.",
      action: "Torna all'app",
      poweredBy: "Con tecnologia Superwall",
    },
  },
  pt: {
    waiting: {
      title: "Conclua no navegador",
      body: "Conclua a compra lá e você terá acesso aqui automaticamente.",
      continue: "Concluir no navegador",
      payInApp: "Continuar no app",
      cancel: "Cancelar",
    },
    success: {
      title: "Tudo pronto",
      body: "Sua compra foi concluída.",
      bodyNoReturn: "Você já pode voltar para o app.",
      bodyPaidElsewhere:
        "Você já comprou isso em outro pagamento, então não foi cobrado novamente.",
      action: "Voltar para o app",
      poweredBy: "Com tecnologia Superwall",
    },
  },
  nl: {
    waiting: {
      title: "Rond af in je browser",
      body: "Rond je aankoop daar af en je krijgt hier automatisch toegang.",
      continue: "Afronden in browser",
      payInApp: "Verder in de app",
      cancel: "Annuleren",
    },
    success: {
      title: "Helemaal klaar",
      body: "Je aankoop is voltooid.",
      bodyNoReturn: "Je kunt nu terug naar de app.",
      bodyPaidElsewhere:
        "Je hebt dit al gekocht in een andere betaling, dus er is niets opnieuw afgeschreven.",
      action: "Terug naar de app",
      poweredBy: "Mogelijk gemaakt door Superwall",
    },
  },
  sv: {
    waiting: {
      title: "Slutför i webbläsaren",
      body: "Slutför köpet där så får du automatiskt tillgång här.",
      continue: "Gör klart i webbläsaren",
      payInApp: "Fortsätt i appen i stället",
      cancel: "Avbryt",
    },
    success: {
      title: "Klart",
      body: "Ditt köp är genomfört.",
      bodyNoReturn: "Du kan gå tillbaka till appen nu.",
      bodyPaidElsewhere: "Du har redan köpt detta i ett annat köp, så du debiterades inte igen.",
      action: "Tillbaka till appen",
      poweredBy: "Drivs av Superwall",
    },
  },
  da: {
    waiting: {
      title: "Afslut i din browser",
      body: "Gennemfør købet dér, så får du automatisk adgang her.",
      continue: "Gør færdig i browseren",
      payInApp: "Fortsæt i appen i stedet",
      cancel: "Annuller",
    },
    success: {
      title: "Det er klaret",
      body: "Dit køb er gennemført.",
      bodyNoReturn: "Du kan gå tilbage til appen nu.",
      bodyPaidElsewhere:
        "Du har allerede købt dette i en anden betaling, så du blev ikke opkrævet igen.",
      action: "Tilbage til appen",
      poweredBy: "Drevet af Superwall",
    },
  },
  nb: {
    waiting: {
      title: "Fullfør i nettleseren",
      body: "Fullfør kjøpet der, så får du automatisk tilgang her.",
      continue: "Gjør ferdig i nettleseren",
      payInApp: "Fortsett i appen i stedet",
      cancel: "Avbryt",
    },
    success: {
      title: "Alt klart",
      body: "Kjøpet er fullført.",
      bodyNoReturn: "Du kan gå tilbake til appen nå.",
      bodyPaidElsewhere:
        "Du har allerede kjøpt dette i en annen betaling, så du ble ikke belastet på nytt.",
      action: "Tilbake til appen",
      poweredBy: "Drevet av Superwall",
    },
  },
  fi: {
    waiting: {
      title: "Viimeistele selaimessa",
      body: "Viimeistele osto siellä, niin saat pääsyn tänne automaattisesti.",
      continue: "Suorita loppuun selaimessa",
      payInApp: "Jatka sovelluksessa",
      cancel: "Peruuta",
    },
    success: {
      title: "Valmista",
      body: "Ostos on valmis.",
      bodyNoReturn: "Voit nyt palata sovellukseen.",
      bodyPaidElsewhere: "Ostit tämän jo toisessa maksussa, joten sinulta ei veloitettu uudelleen.",
      action: "Palaa sovellukseen",
      poweredBy: "Palvelun tarjoaa Superwall",
    },
  },
  pl: {
    waiting: {
      title: "Dokończ w przeglądarce",
      body: "Dokończ zakup tam, a dostęp pojawi się tutaj automatycznie.",
      continue: "Zakończ w przeglądarce",
      payInApp: "Kontynuuj w aplikacji",
      cancel: "Anuluj",
    },
    success: {
      title: "Gotowe",
      body: "Zakup został zakończony.",
      bodyNoReturn: "Możesz już wrócić do aplikacji.",
      bodyPaidElsewhere: "Kupiono to już w innej płatności, więc nie pobrano opłaty ponownie.",
      action: "Wróć do aplikacji",
      poweredBy: "Obsługiwane przez Superwall",
    },
  },
  cs: {
    waiting: {
      title: "Dokončete v prohlížeči",
      body: "Dokončete nákup tam a přístup tady získáte automaticky.",
      continue: "Dokončit v prohlížeči",
      payInApp: "Pokračovat v aplikaci",
      cancel: "Zrušit",
    },
    success: {
      title: "Hotovo",
      body: "Nákup je dokončen.",
      bodyNoReturn: "Nyní se můžete vrátit do aplikace.",
      bodyPaidElsewhere:
        "Tohle jste už koupili v jiné platbě, takže vám nebylo nic znovu účtováno.",
      action: "Zpět do aplikace",
      poweredBy: "Využívá Superwall",
    },
  },
  sk: {
    waiting: {
      title: "Dokončite v prehliadači",
      body: "Dokončite nákup tam a prístup tu získate automaticky.",
      continue: "Dokončiť v prehliadači",
      payInApp: "Pokračovať v aplikácii",
      cancel: "Zrušiť",
    },
    success: {
      title: "Hotovo",
      body: "Nákup je dokončený.",
      bodyNoReturn: "Teraz sa môžete vrátiť do aplikácie.",
      bodyPaidElsewhere: "Toto ste už kúpili v inej platbe, takže vám nebolo nič znova účtované.",
      action: "Späť do aplikácie",
      poweredBy: "Využíva Superwall",
    },
  },
  hu: {
    waiting: {
      title: "Fejezze be a böngészőben",
      body: "Fejezze be ott a vásárlást, és itt automatikusan hozzáférést kap.",
      continue: "Befejezés a böngészőben",
      payInApp: "Folytatás az appban",
      cancel: "Mégse",
    },
    success: {
      title: "Minden kész",
      body: "A vásárlás befejeződött.",
      bodyNoReturn: "Most már visszatérhet az alkalmazásba.",
      bodyPaidElsewhere:
        "Ezt már megvásárolta egy másik fizetés során, így nem terheltük meg újra.",
      action: "Vissza az alkalmazásba",
      poweredBy: "Üzemelteti: Superwall",
    },
  },
  ro: {
    waiting: {
      title: "Finalizează în browser",
      body: "Finalizează achiziția acolo și vei primi acces aici automat.",
      continue: "Încheie în browser",
      payInApp: "Continuă în aplicație",
      cancel: "Anulează",
    },
    success: {
      title: "Gata",
      body: "Achiziția este finalizată.",
      bodyNoReturn: "Acum poți reveni în aplicație.",
      bodyPaidElsewhere:
        "Ai cumpărat deja acest lucru într-o altă plată, așa că nu ai fost taxat din nou.",
      action: "Înapoi la aplicație",
      poweredBy: "Oferit de Superwall",
    },
  },
  hr: {
    waiting: {
      title: "Dovršite u pregledniku",
      body: "Dovršite kupnju ondje i ovdje ćete automatski dobiti pristup.",
      continue: "Dovrši u pregledniku",
      payInApp: "Nastavi u aplikaciji",
      cancel: "Odustani",
    },
    success: {
      title: "Sve je spremno",
      body: "Kupnja je dovršena.",
      bodyNoReturn: "Sada se možete vratiti u aplikaciju.",
      bodyPaidElsewhere:
        "Ovo ste već kupili u drugom plaćanju, pa vam ništa nije ponovno naplaćeno.",
      action: "Natrag u aplikaciju",
      poweredBy: "Pokreće Superwall",
    },
  },
  el: {
    waiting: {
      title: "Ολοκληρώστε στο πρόγραμμα περιήγησης",
      body: "Ολοκληρώστε την αγορά εκεί και θα αποκτήσετε πρόσβαση εδώ αυτόματα.",
      continue: "Ολοκλήρωση στο πρόγραμμα περιήγησης",
      payInApp: "Συνέχεια στην εφαρμογή",
      cancel: "Ακύρωση",
    },
    success: {
      title: "Όλα έτοιμα",
      body: "Η αγορά ολοκληρώθηκε.",
      bodyNoReturn: "Μπορείτε τώρα να επιστρέψετε στην εφαρμογή.",
      bodyPaidElsewhere: "Το έχετε ήδη αγοράσει σε άλλη πληρωμή, οπότε δεν χρεωθήκατε ξανά.",
      action: "Επιστροφή στην εφαρμογή",
      poweredBy: "Με την υποστήριξη του Superwall",
    },
  },
  tr: {
    waiting: {
      title: "Tarayıcınızda tamamlayın",
      body: "Satın alma işlemini orada tamamlayın, erişiminiz burada otomatik olarak açılır.",
      continue: "Tarayıcıda Tamamla",
      payInApp: "Uygulamada Devam Et",
      cancel: "İptal",
    },
    success: {
      title: "Her şey hazır",
      body: "Satın alma işleminiz tamamlandı.",
      bodyNoReturn: "Artık uygulamaya dönebilirsiniz.",
      bodyPaidElsewhere:
        "Bunu zaten başka bir ödemede satın aldınız, bu yüzden tekrar ücret alınmadı.",
      action: "Uygulamaya Dön",
      poweredBy: "Superwall tarafından desteklenmektedir",
    },
  },
  ru: {
    waiting: {
      title: "Завершите в браузере",
      body: "Завершите покупку там — доступ здесь откроется автоматически.",
      continue: "Завершить в браузере",
      payInApp: "Продолжить в приложении",
      cancel: "Отмена",
    },
    success: {
      title: "Готово",
      body: "Покупка завершена.",
      bodyNoReturn: "Теперь можно вернуться в приложение.",
      bodyPaidElsewhere: "Вы уже купили это в другом платеже, поэтому повторно деньги не списаны.",
      action: "Вернуться в приложение",
      poweredBy: "Работает на Superwall",
    },
  },
  uk: {
    waiting: {
      title: "Завершіть у браузері",
      body: "Завершіть покупку там — доступ тут відкриється автоматично.",
      continue: "Завершити в браузері",
      payInApp: "Продовжити в застосунку",
      cancel: "Скасувати",
    },
    success: {
      title: "Готово",
      body: "Покупку завершено.",
      bodyNoReturn: "Тепер можна повернутися в застосунок.",
      bodyPaidElsewhere: "Ви вже придбали це в іншому платежі, тому повторно кошти не списано.",
      action: "Повернутися в застосунок",
      poweredBy: "Працює на Superwall",
    },
  },
  ja: {
    waiting: {
      title: "ブラウザで完了してください",
      body: "ブラウザで購入を完了すると、自動的にこちらで利用できるようになります。",
      continue: "ブラウザで完了する",
      payInApp: "アプリで続ける",
      cancel: "キャンセル",
    },
    success: {
      title: "完了しました",
      body: "購入が完了しました。",
      bodyNoReturn: "アプリに戻ってください。",
      bodyPaidElsewhere: "別の決済ですでに購入済みのため、再度請求されることはありません。",
      action: "アプリに戻る",
      poweredBy: "Powered by Superwall",
    },
  },
  ko: {
    waiting: {
      title: "브라우저에서 완료하세요",
      body: "브라우저에서 구매를 완료하면 여기에서 자동으로 이용할 수 있습니다.",
      continue: "브라우저에서 완료하기",
      payInApp: "앱에서 계속하기",
      cancel: "취소",
    },
    success: {
      title: "모두 완료되었습니다",
      body: "구매가 완료되었습니다.",
      bodyNoReturn: "이제 앱으로 돌아가셔도 됩니다.",
      bodyPaidElsewhere: "다른 결제에서 이미 구매하셨으므로 다시 청구되지 않았습니다.",
      action: "앱으로 돌아가기",
      poweredBy: "Superwall 제공",
    },
  },
  "zh-Hans": {
    waiting: {
      title: "请在浏览器中完成",
      body: "在浏览器中完成购买后，即可在此自动获得访问权限。",
      continue: "在浏览器中完成",
      payInApp: "改为在 App 内继续",
      cancel: "取消",
    },
    success: {
      title: "一切就绪",
      body: "购买已完成。",
      bodyNoReturn: "现在可以返回应用了。",
      bodyPaidElsewhere: "你已在另一笔付款中购买，因此不会再次扣费。",
      action: "返回应用",
      poweredBy: "由 Superwall 提供支持",
    },
  },
  "zh-Hant": {
    waiting: {
      title: "請在瀏覽器中完成",
      body: "在瀏覽器中完成購買後，即可在此自動取得存取權限。",
      continue: "在瀏覽器中完成",
      payInApp: "改為在 App 內繼續",
      cancel: "取消",
    },
    success: {
      title: "一切就緒",
      body: "購買已完成。",
      bodyNoReturn: "現在可以返回 App 了。",
      bodyPaidElsewhere: "你已在另一筆付款中購買，因此不會再次扣款。",
      action: "返回 App",
      poweredBy: "由 Superwall 提供支援",
    },
  },
  ar: {
    dir: "rtl",
    waiting: {
      title: "أكمل في المتصفح",
      body: "أكمل عملية الشراء هناك وستحصل على الوصول هنا تلقائيًا.",
      continue: "الإكمال في المتصفح",
      payInApp: "المتابعة داخل التطبيق",
      cancel: "إلغاء",
    },
    success: {
      title: "تم كل شيء",
      body: "اكتملت عملية الشراء.",
      bodyNoReturn: "يمكنك الآن العودة إلى التطبيق.",
      bodyPaidElsewhere: "لقد اشتريت هذا بالفعل في عملية دفع أخرى، لذا لم يتم خصم المبلغ مرة أخرى.",
      action: "العودة إلى التطبيق",
      poweredBy: "مدعوم من Superwall",
    },
  },
  he: {
    dir: "rtl",
    waiting: {
      title: "סיימו בדפדפן",
      body: "השלימו את הרכישה שם ותקבלו גישה כאן באופן אוטומטי.",
      continue: "השלמה בדפדפן",
      payInApp: "המשך באפליקציה",
      cancel: "ביטול",
    },
    success: {
      title: "הכול מוכן",
      body: "הרכישה הושלמה.",
      bodyNoReturn: "אפשר לחזור לאפליקציה עכשיו.",
      bodyPaidElsewhere: "כבר רכשת את זה בתשלום אחר, ולכן לא חויבת שוב.",
      action: "חזרה לאפליקציה",
      poweredBy: "מופעל על ידי Superwall",
    },
  },
  hi: {
    waiting: {
      title: "ब्राउज़र में पूरा करें",
      body: "वहाँ अपनी खरीदारी पूरी करें और आपको यहाँ अपने आप एक्सेस मिल जाएगा।",
      continue: "ब्राउज़र में समाप्त करें",
      payInApp: "इसके बजाय ऐप में जारी रखें",
      cancel: "रद्द करें",
    },
    success: {
      title: "सब तैयार है",
      body: "आपकी खरीदारी पूरी हो गई।",
      bodyNoReturn: "अब आप ऐप पर वापस जा सकते हैं।",
      bodyPaidElsewhere:
        "आप इसे पहले ही किसी दूसरे भुगतान में खरीद चुके हैं, इसलिए आपसे दोबारा शुल्क नहीं लिया गया।",
      action: "ऐप पर वापस जाएँ",
      poweredBy: "Superwall द्वारा संचालित",
    },
  },
  id: {
    waiting: {
      title: "Selesaikan di browser",
      body: "Selesaikan pembelian di sana dan Anda akan otomatis mendapatkan akses di sini.",
      continue: "Selesaikan di Browser",
      payInApp: "Lanjutkan di Aplikasi",
      cancel: "Batal",
    },
    success: {
      title: "Semua beres",
      body: "Pembelian Anda selesai.",
      bodyNoReturn: "Anda sekarang bisa kembali ke aplikasi.",
      bodyPaidElsewhere: "Anda sudah membelinya di pembayaran lain, jadi Anda tidak ditagih lagi.",
      action: "Kembali ke Aplikasi",
      poweredBy: "Didukung oleh Superwall",
    },
  },
  ms: {
    waiting: {
      title: "Selesaikan dalam pelayar",
      body: "Lengkapkan pembelian di sana dan anda akan mendapat akses di sini secara automatik.",
      continue: "Selesaikan dalam Pelayar",
      payInApp: "Teruskan dalam Aplikasi",
      cancel: "Batal",
    },
    success: {
      title: "Semua selesai",
      body: "Pembelian anda selesai.",
      bodyNoReturn: "Anda kini boleh kembali ke aplikasi.",
      bodyPaidElsewhere: "Anda sudah membelinya dalam pembayaran lain, jadi anda tidak dicaj lagi.",
      action: "Kembali ke Aplikasi",
      poweredBy: "Dikuasakan oleh Superwall",
    },
  },
  th: {
    waiting: {
      title: "ดำเนินการต่อในเบราว์เซอร์",
      body: "ทำการซื้อให้เสร็จในเบราว์เซอร์ แล้วคุณจะเข้าถึงได้ที่นี่โดยอัตโนมัติ",
      continue: "ทำต่อในเบราว์เซอร์",
      payInApp: "ทำต่อในแอปแทน",
      cancel: "ยกเลิก",
    },
    success: {
      title: "เรียบร้อยแล้ว",
      body: "การซื้อของคุณเสร็จสมบูรณ์",
      bodyNoReturn: "คุณสามารถกลับไปที่แอปได้แล้ว",
      bodyPaidElsewhere: "คุณซื้อรายการนี้ไปแล้วในการชำระเงินอื่น จึงไม่ถูกเรียกเก็บเงินซ้ำ",
      action: "กลับไปที่แอป",
      poweredBy: "ขับเคลื่อนโดย Superwall",
    },
  },
  vi: {
    waiting: {
      title: "Hoàn tất trong trình duyệt",
      body: "Hoàn tất giao dịch mua ở đó và bạn sẽ tự động có quyền truy cập tại đây.",
      continue: "Hoàn thành trên trình duyệt",
      payInApp: "Tiếp tục trong ứng dụng",
      cancel: "Hủy",
    },
    success: {
      title: "Đã xong",
      body: "Giao dịch mua đã hoàn tất.",
      bodyNoReturn: "Giờ bạn có thể quay lại ứng dụng.",
      bodyPaidElsewhere:
        "Bạn đã mua mục này trong một lần thanh toán khác, nên không bị tính phí lại.",
      action: "Quay lại ứng dụng",
      poweredBy: "Được cung cấp bởi Superwall",
    },
  },
} satisfies Record<string, LocaleCopy>;

type TeleportLocale = keyof typeof COPY;

const isTeleportLocale = (value: string): value is TeleportLocale => Object.hasOwn(COPY, value);

const ALIASES: Record<string, TeleportLocale> = {
  no: "nb",
  nn: "nb",
  iw: "he",
  in: "id",
};

const TRADITIONAL_CHINESE_REGIONS = new Set(["tw", "hk", "mo"]);

const resolveTeleportLocale = (input: string | undefined): TeleportLocale => {
  const parts = String(input ?? "")
    .toLowerCase()
    .split(/[-_]/)
    .filter(Boolean);
  const language = parts[0] ?? "en";
  if (language === "zh") {
    const traditional =
      parts.includes("hant") ||
      parts.slice(1).some((part) => TRADITIONAL_CHINESE_REGIONS.has(part));
    return parts.includes("hans") || !traditional ? "zh-Hans" : "zh-Hant";
  }
  if (isTeleportLocale(language)) return language;
  return ALIASES[language] ?? "en";
};

export const teleportCopyFor = (locale: string | undefined): LocaleCopy =>
  COPY[resolveTeleportLocale(locale)];
