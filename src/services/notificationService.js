// Ce service est un placeholder pour l'implémentation des notifications
// Vous pourrez l'étendre pour utiliser OneSignal ou un autre service

const User = require("../models/User");
const Game = require("../models/Game");
// Vous pourriez intégrer ici les packages nécessaires pour les notifications push comme Firebase FCM

/**
 * Envoie une notification à un utilisateur spécifique
 * @param {string} userId - ID de l'utilisateur
 * @param {string} title - Titre de la notification
 * @param {string} body - Corps de la notification
 * @param {Object} data - Données supplémentaires pour la notification
 * @returns {Promise<boolean>} Succès de l'envoi
 */
async function sendNotificationToUser(userId, title, body, data = {}) {
  try {
    const user = await User.findById(userId);

    // Vérifier si l'utilisateur existe et qu'il a activé les notifications
    if (
      !user ||
      !user.notificationSettings ||
      !user.notificationSettings.enabled
    ) {
      console.log(`Notifications désactivées pour l'utilisateur ${userId}`);
      return false;
    }

    // Vérifier si l'utilisateur a un token de notification
    if (!user.notificationSettings.pushToken) {
      console.log(
        `Token de notification manquant pour l'utilisateur ${userId}`
      );
      return false;
    }

    // Ici, vous implémenteriez l'envoi réel de la notification
    // Par exemple, avec Firebase Cloud Messaging (FCM)
    console.log(`Envoi d'une notification à ${user.username}:`, {
      title,
      body,
      token: user.notificationSettings.pushToken,
      data,
    });

    // Simulation de l'envoi pour l'instant
    console.log("Notification envoyée avec succès");

    return true;
  } catch (error) {
    console.error(
      `Erreur lors de l'envoi de la notification à ${userId}:`,
      error
    );
    return false;
  }
}

/**
 * Notifie un utilisateur à propos d'un nouveau jeu détecté
 * @param {string} userId - ID de l'utilisateur
 * @param {Object} game - Informations sur le jeu
 * @returns {Promise<boolean>} Succès de l'envoi
 */
async function notifyUserAboutNewGame(userId, game) {
  return sendNotificationToUser(
    userId,
    "Nouveau jeu détecté !",
    `${game.name} a été ajouté à votre bibliothèque.`,
    {
      type: "newGame",
      appId: game.appId,
      name: game.name,
    }
  );
}

/**
 * Notifie un utilisateur à propos d'une actualité pour un jeu suivi
 * @param {string} userId - ID de l'utilisateur
 * @param {Object} game - Informations sur le jeu
 * @param {Object} news - Informations sur l'actualité
 * @returns {Promise<boolean>} Succès de l'envoi
 */
async function notifyUserAboutGameNews(userId, game, news) {
  return sendNotificationToUser(
    userId,
    `Actualité: ${game.name}`,
    news.title || "Nouvelle actualité disponible",
    {
      type: "gameNews",
      appId: game.appId,
      name: game.name,
      newsId: news.gid || news.id,
      url: news.url,
    }
  );
}

/**
 * Envoie des notifications à tous les utilisateurs qui suivent un jeu spécifique
 * @param {string} appId - ID du jeu
 * @param {Object} news - Informations sur l'actualité
 * @returns {Promise<number>} Nombre de notifications envoyées
 */
async function notifyAllFollowersAboutGameNews(appId, news) {
  try {
    // Récupérer le jeu de la base de données centrale
    const game = await Game.findOne({ appId }).populate("followers");

    if (!game || !game.followers || game.followers.length === 0) {
      console.log(`Aucun utilisateur ne suit le jeu ${appId}`);
      return 0;
    }

    let notificationCount = 0;

    // Pour chaque utilisateur qui suit ce jeu
    for (const user of game.followers) {
      const success = await notifyUserAboutGameNews(user._id, game, news);
      if (success) notificationCount++;
    }

    console.log(
      `${notificationCount} notifications envoyées pour le jeu ${game.name}`
    );
    return notificationCount;
  } catch (error) {
    console.error(`Erreur lors de l'envoi des notifications:`, error);
    return 0;
  }
}

module.exports = {
  sendNotificationToUser,
  notifyUserAboutNewGame,
  notifyUserAboutGameNews,
  notifyAllFollowersAboutGameNews,
};
