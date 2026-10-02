// push-config.js — adresse du "relais" de notifications push (V35).
//
// Le navigateur seul ne peut pas envoyer un push à un autre appareil : il
// faut un petit serveur. Le fichier push-relay/apps-script.gs (gratuit, sans
// carte bancaire, hébergé dans ton compte Google) joue ce rôle. Une fois
// déployé, colle son URL ici (entre les guillemets) — voir README, section
// "Notifications push en temps réel". Vide = pas de push automatique (la
// messagerie continue de fonctionner normalement, en temps réel, quand
// l'app est ouverte).
window.JIEE_PUSH_RELAY_URL = "";
