# Sons AIM (échantillons locaux)

Ce dossier est ignoré par git (sauf ce fichier) : les sons originaux
d'AOL Instant Messenger appartiennent à AOL et ne sont pas redistribués
dans le dépôt.

Sans fichier, l'application synthétise des sons approchants (Web Audio).
Pour retrouver les vrais sons, déposer ici :

| Fichier         | Son AIM d'origine |
| --------------- | ----------------- |
| `doorOpen.wav`  | BuddyIn.wav       |
| `doorSlam.wav`  | BuddyOut.wav      |
| `imReceive.wav` | IM.wav            |
| `imSend.wav`    | (optionnel)       |
| `welcome.wav`   | Welcome.wav       |
| `modem.wav`     | (optionnel)       |

Formats acceptés (dans cet ordre) : `.flac`, `.mp3`, `.wav`, `.ogg`. Pour les gros
fichiers, `.flac` est sans perte et bien plus léger :
`ffmpeg -i modem.wav -c:a flac -compression_level 12 modem.flac`. Garder le `.wav`
à côté : il n'est téléchargé que si le navigateur ne décode pas le FLAC. Source archivée connue :
<https://archive.org/details/im_20191103>.
