const User = require("../models/User");
const Game = require("../models/Game");
const steamService = require("./steamService");
const notificationService = require("./notificationService");

/**
 * Synchronise les jeux de tous les utilisateurs enregistrés
 * @returns {Promise<Object>} Statistiques de synchronisation
 */
async function syncAllUsersGames() {
  console.log(
    "Démarrage de la synchronisation automatique des bibliothèques..."
  );
  const stats = {
    totalUsers: 0,
    usersProcessed: 0,
    usersWithNewGames: 0,
    totalNewGames: 0,
    errors: 0,
  };

  try {
    // Récupérer tous les utilisateurs
    const users = await User.find({});
    stats.totalUsers = users.length;
    console.log(`Synchronisation des jeux pour ${users.length} utilisateurs`);

    // Pour chaque utilisateur
    for (const user of users) {
      try {
        stats.usersProcessed++;
        const result = await syncUserGames(user);

        if (result.newGames.length > 0) {
          stats.usersWithNewGames++;
          stats.totalNewGames += result.newGames.length;
        }
      } catch (error) {
        console.error(
          `Erreur lors de la synchronisation des jeux pour l'utilisateur ${user.username}:`,
          error
        );
        stats.errors++;
      }
    }

    console.log("Synchronisation automatique terminée:", stats);
    return stats;
  } catch (error) {
    console.error(
      "Erreur lors de la synchronisation automatique des jeux:",
      error
    );
    throw error;
  }
}

/**
 * Vérifie toutes les 10 minutes si de nouveaux jeux ont été achetés
 * @returns {Promise<Object>} Statistiques de vérification
 */
async function checkNewGamesForAllUsers() {
  console.log("Vérification des nouveaux jeux pour tous les utilisateurs...");
  const stats = {
    totalUsers: 0,
    usersProcessed: 0,
    usersWithNewGames: 0,
    totalNewGames: 0,
    errors: 0,
  };

  try {
    // Récupérer tous les utilisateurs
    const users = await User.find({});
    stats.totalUsers = users.length;

    // Pour chaque utilisateur
    for (const user of users) {
      try {
        stats.usersProcessed++;
        const result = await checkNewGamesForUser(user);

        if (result.newGames.length > 0) {
          stats.usersWithNewGames++;
          stats.totalNewGames += result.newGames.length;

          // Marquer ces jeux comme en attente pour l'utilisateur
          await addGamesToPending(user._id, result.newGames);

          // Si l'option de suivre automatiquement est activée, suivre ces nouveaux jeux
          if (
            user.notificationSettings &&
            user.notificationSettings.autoFollowNewGames
          ) {
            await autoFollowNewGames(user._id, result.newGames);
          }
        }
      } catch (error) {
        console.error(
          `Erreur lors de la vérification des nouveaux jeux pour l'utilisateur ${user.username}:`,
          error
        );
        stats.errors++;
      }
    }

    console.log("Vérification des nouveaux jeux terminée:", stats);
    return stats;
  } catch (error) {
    console.error("Erreur lors de la vérification des nouveaux jeux:", error);
    throw error;
  }
}

/**
 * Vérifie si un utilisateur a acheté de nouveaux jeux
 * @param {Object} user - L'utilisateur à vérifier
 * @returns {Promise<Object>} Résultat avec les nouveaux jeux détectés
 */
async function checkNewGamesForUser(user) {
  const result = {
    userId: user._id,
    steamId: user.steamId,
    username: user.username,
    newGames: [],
    error: null,
  };

  try {
    console.log(
      `Vérification des nouveaux jeux pour ${user.username} (${user.steamId})`
    );

    // Récupérer la liste actuelle des jeux
    const userGames = await steamService.getUserGames(user.steamId);

    if (!userGames || !Array.isArray(userGames)) {
      console.error(`Réponse invalide de l'API Steam pour ${user.username}`);
      result.error = "Réponse invalide de l'API Steam";
      return result;
    }

    // Créer un ensemble d'IDs de jeux possédés
    const ownedGameIds = new Set();
    if (user.ownedGames && Array.isArray(user.ownedGames)) {
      user.ownedGames.forEach((game) => ownedGameIds.add(game.appId));
    }

    // Vérifier les nouveaux jeux
    for (const game of userGames) {
      const appId = game.appid.toString();

      // Si ce jeu n'est pas dans la liste des jeux possédés, c'est un nouveau jeu
      if (!ownedGameIds.has(appId)) {
        console.log(
          `Nouveau jeu détecté pour ${user.username}: ${game.name} (${appId})`
        );

        // Ajouter à la liste des nouveaux jeux détectés
        result.newGames.push({
          appId,
          name: game.name,
          logoUrl: game.img_logo_url
            ? `http://media.steampowered.com/steamcommunity/public/images/apps/${game.appid}/${game.img_logo_url}.jpg`
            : null,
        });

        // Ajouter à la liste des jeux possédés
        await User.updateOne(
          { _id: user._id },
          {
            $push: {
              ownedGames: {
                appId,
                addedAt: new Date(),
              },
            },
          }
        );
      }
    }

    return result;
  } catch (error) {
    console.error(
      `Erreur lors de la vérification pour ${user.username}:`,
      error
    );
    result.error = error.message;
    return result;
  }
}

/**
 * Ajoute des jeux à la liste d'attente de l'utilisateur
 * @param {string} userId - ID de l'utilisateur
 * @param {Array} games - Liste des jeux à ajouter
 */
async function addGamesToPending(userId, games) {
  if (!games || games.length === 0) return;

  const pendingGames = games.map((game) => ({
    appId: game.appId,
    name: game.name,
    logoUrl: game.logoUrl,
    detectedAt: new Date(),
  }));

  await User.updateOne(
    { _id: userId },
    { $push: { pendingNewGames: { $each: pendingGames } } }
  );

  console.log(
    `${games.length} jeux ajoutés à la liste d'attente pour l'utilisateur ${userId}`
  );
}

/**
 * Suit automatiquement les nouveaux jeux pour un utilisateur
 * @param {string} userId - ID de l'utilisateur
 * @param {Array} games - Liste des jeux à suivre
 */
async function autoFollowNewGames(userId, games) {
  if (!games || games.length === 0) return;

  const user = await User.findById(userId);
  if (!user) {
    console.error(`Utilisateur non trouvé: ${userId}`);
    return;
  }

  for (const game of games) {
    // Vérifier si le jeu existe déjà dans la base de données centrale
    let gameDoc = await Game.findOne({ appId: game.appId });

    // Si le jeu n'existe pas encore, le créer
    if (!gameDoc) {
      gameDoc = new Game({
        appId: game.appId,
        name: game.name,
        logoUrl: game.logoUrl,
        lastNewsTimestamp: 0,
        lastUpdateTimestamp: Date.now(),
        followers: [userId],
      });
      await gameDoc.save();
    } else {
      // Sinon, ajouter l'utilisateur comme follower s'il ne l'est pas déjà
      if (!gameDoc.followers.includes(userId)) {
        gameDoc.followers.push(userId);
        await gameDoc.save();
      }
    }

    // Ajouter le jeu à la liste des jeux suivis par l'utilisateur
    const isAlreadyFollowing = user.followedGames.some(
      (g) => g.appId === game.appId
    );

    if (!isAlreadyFollowing) {
      user.followedGames.push({
        appId: game.appId,
        name: game.name,
        logoUrl: game.logoUrl,
        lastNewsTimestamp: 0,
        lastUpdateTimestamp: Date.now(),
      });
    }
  }

  // Sauvegarder les changements
  await user.save();
  console.log(
    `${games.length} nouveaux jeux suivis automatiquement pour l'utilisateur ${user.username}`
  );
}

/**
 * Récupère et synchronise les jeux en attente pour un utilisateur
 * @param {string} userId - ID de l'utilisateur
 * @returns {Promise<Object>} Résultat avec les jeux synchronisés
 */
async function syncPendingGamesForUser(userId) {
  const result = {
    userId,
    pendingGames: [],
    processedGames: [],
    error: null,
  };

  try {
    const user = await User.findById(userId);
    if (!user) {
      result.error = "Utilisateur non trouvé";
      return result;
    }

    // Si aucun jeu en attente, retourner directement
    if (!user.pendingNewGames || user.pendingNewGames.length === 0) {
      return result;
    }

    // Copier les jeux en attente pour le résultat
    result.pendingGames = [...user.pendingNewGames];

    // Pour chaque jeu en attente, récupérer des informations complètes
    for (const game of user.pendingNewGames) {
      try {
        // Ici, vous pourriez faire un appel à l'API Steam pour obtenir plus d'informations sur le jeu
        // Comme les détails, la description, etc.

        result.processedGames.push({
          appId: game.appId,
          name: game.name,
          logoUrl: game.logoUrl,
          detectedAt: game.detectedAt,
        });
      } catch (error) {
        console.error(
          `Erreur lors de la synchronisation du jeu ${game.appId}:`,
          error
        );
      }
    }

    // Vider la liste des jeux en attente
    user.pendingNewGames = [];
    await user.save();

    console.log(
      `${result.processedGames.length} jeux en attente synchronisés pour ${user.username}`
    );
    return result;
  } catch (error) {
    console.error(
      `Erreur lors de la synchronisation des jeux en attente:`,
      error
    );
    result.error = error.message;
    return result;
  }
}

/**
 * Synchronise un groupe spécifique d'utilisateurs basé sur un index de groupe
 * Cette méthode permet de répartir la charge en synchronisant différents groupes d'utilisateurs à différents moments
 * @param {number} groupIndex - Index du groupe à synchroniser (0-basé)
 * @param {number} totalGroups - Nombre total de groupes
 * @returns {Promise<Object>} Statistiques de synchronisation pour ce groupe
 */
async function syncUserGroupByIndex(groupIndex, totalGroups) {
  console.log(
    `Synchronisation du groupe ${groupIndex + 1}/${totalGroups} d'utilisateurs`
  );

  const stats = {
    groupIndex,
    totalGroups,
    totalUsers: 0,
    usersProcessed: 0,
    usersWithNewGames: 0,
    totalNewGames: 0,
    errors: 0,
  };

  try {
    // Récupérer tous les utilisateurs
    const allUsers = await User.find({});
    stats.totalUsers = allUsers.length;

    // Si aucun utilisateur, retourner immédiatement
    if (allUsers.length === 0) {
      console.log("Aucun utilisateur trouvé, rien à synchroniser.");
      return stats;
    }

    // Calculer combien d'utilisateurs par groupe
    const groupSize = Math.ceil(allUsers.length / totalGroups);

    // Déterminer l'index de début et de fin pour ce groupe
    const startIndex = groupIndex * groupSize;
    const endIndex = Math.min(startIndex + groupSize, allUsers.length);

    // Extraire les utilisateurs de ce groupe
    const groupUsers = allUsers.slice(startIndex, endIndex);

    console.log(
      `Traitement de ${groupUsers.length} utilisateurs du groupe ${
        groupIndex + 1
      }/${totalGroups} (index ${startIndex}-${endIndex - 1})`
    );

    // Synchroniser chaque utilisateur du groupe
    for (const user of groupUsers) {
      try {
        stats.usersProcessed++;
        const result = await syncUserGames(user);

        if (result.newGames && result.newGames.length > 0) {
          stats.usersWithNewGames++;
          stats.totalNewGames += result.newGames.length;
        }
      } catch (error) {
        console.error(
          `Erreur lors de la synchronisation de l'utilisateur ${user.username}:`,
          error
        );
        stats.errors++;
      }
    }

    console.log(
      `Synchronisation du groupe ${groupIndex + 1}/${totalGroups} terminée:`,
      stats
    );
    return stats;
  } catch (error) {
    console.error(
      `Erreur lors de la synchronisation du groupe ${
        groupIndex + 1
      }/${totalGroups}:`,
      error
    );
    stats.errors++;
    return stats;
  }
}

/**
 * Synchronise les jeux d'un utilisateur spécifique
 * @param {Object} user - Utilisateur pour lequel synchroniser les jeux
 * @returns {Promise<Object>} Résultat de la synchronisation
 */
async function syncUserGames(user) {
  const result = {
    userId: user._id,
    steamId: user.steamId,
    username: user.username,
    newGames: [],
    updatedGames: [],
    error: null,
    lastSyncTime: new Date(),
  };

  try {
    console.log(
      `Synchronisation des jeux pour ${user.username} (${user.steamId})`
    );

    // Vérifier si la dernière synchronisation est récente (moins de 6 heures)
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const lastSyncTime = user.lastChecked || new Date(0);

    if (lastSyncTime > sixHoursAgo) {
      console.log(
        `Utilisateur ${
          user.username
        } synchronisé récemment (${lastSyncTime.toISOString()}), en attente.`
      );
      return {
        ...result,
        skipped: true,
        message: "Synchronisation récente, ignorée",
      };
    }

    // Récupérer la liste actuelle des jeux
    const userGames = await steamService.getUserGames(user.steamId);

    if (!userGames || !Array.isArray(userGames)) {
      console.error(`Réponse invalide de l'API Steam pour ${user.username}`);
      result.error = "Réponse invalide de l'API Steam";
      return result;
    }

    // Liste des jeux actuellement suivis
    const followedGamesMap = new Map();
    if (user.followedGames && Array.isArray(user.followedGames)) {
      user.followedGames.forEach((game) => {
        followedGamesMap.set(game.appId, game);
      });
    }

    // Liste des jeux actuellement synchronisés
    const syncedGamesMap = new Map();
    if (user.lastSyncedGames && Array.isArray(user.lastSyncedGames)) {
      user.lastSyncedGames.forEach((game) => {
        syncedGamesMap.set(game.appId, game);
      });
    }

    // Nouveaux jeux détectés
    const newGames = [];
    const updatedSyncedGames = [];
    const updatedFollowedGames = Array.from(followedGamesMap.values());

    // Pour chaque jeu dans la bibliothèque Steam
    for (const game of userGames) {
      const appId = game.appid.toString();

      // Si le jeu n'est pas dans lastSyncedGames, c'est un nouveau jeu
      if (!syncedGamesMap.has(appId)) {
        console.log(
          `Nouveau jeu détecté pour ${user.username}: ${game.name} (${appId})`
        );

        // Ajouter aux jeux synchronisés
        const newSyncedGame = {
          appId,
          name: game.name,
          logoUrl: game.img_logo_url
            ? `http://media.steampowered.com/steamcommunity/public/images/apps/${game.appid}/${game.img_logo_url}.jpg`
            : null,
          addedAt: new Date(),
        };

        updatedSyncedGames.push(newSyncedGame);

        // Ajouter aux nouveaux jeux détectés
        newGames.push({
          appId,
          name: game.name,
        });

        // Si l'option autoFollowNewGames est activée, ajouter le jeu aux jeux suivis
        if (
          user.notificationSettings &&
          user.notificationSettings.autoFollowNewGames
        ) {
          if (!followedGamesMap.has(appId)) {
            const followedGame = {
              appId,
              name: game.name,
              logoUrl: game.img_logo_url
                ? `http://media.steampowered.com/steamcommunity/public/images/apps/${game.appid}/${game.img_logo_url}.jpg`
                : null,
              lastNewsTimestamp: 0,
              lastUpdateTimestamp: Date.now(), // Marquer comme récemment ajouté
            };

            updatedFollowedGames.push(followedGame);
            result.updatedGames.push({
              appId,
              name: game.name,
              action: "added",
            });
          }
        }
      } else {
        // Le jeu est déjà dans lastSyncedGames, conserver ses informations avec mises à jour si nécessaire
        const existingGame = syncedGamesMap.get(appId);

        // Mettre à jour le logo si nécessaire
        if (game.img_logo_url && !existingGame.logoUrl) {
          existingGame.logoUrl = `http://media.steampowered.com/steamcommunity/public/images/apps/${game.appid}/${game.img_logo_url}.jpg`;
          result.updatedGames.push({
            appId,
            name: game.name,
            action: "updated",
          });
        }

        updatedSyncedGames.push(existingGame);
      }
    }

    // Mettre à jour l'utilisateur si des changements ont été détectés
    const hasChanges = newGames.length > 0 || result.updatedGames.length > 0;

    if (hasChanges) {
      // Mettre à jour lastSyncedGames
      user.lastSyncedGames = updatedSyncedGames;

      // Mettre à jour followedGames si nécessaire
      if (
        user.notificationSettings &&
        user.notificationSettings.autoFollowNewGames &&
        newGames.length > 0
      ) {
        user.followedGames = updatedFollowedGames;
      }

      // Mettre à jour la date de dernière vérification
      user.lastChecked = new Date();

      // Enregistrer les modifications
      await user.save();

      console.log(
        `${newGames.length} nouveaux jeux ajoutés pour ${user.username}`
      );
      result.newGames = newGames;
    } else {
      // Même s'il n'y a pas de changement, mettre à jour la date de dernière vérification
      user.lastChecked = new Date();
      await user.save();

      console.log(`Aucun nouveau jeu détecté pour ${user.username}`);
    }

    return result;
  } catch (error) {
    console.error(
      `Erreur lors de la synchronisation des jeux pour ${user.username}:`,
      error
    );
    result.error = error.message;
    return result;
  }
}

module.exports = {
  syncAllUsersGames,
  syncUserGroupByIndex,
  syncUserGames,
  checkNewGamesForAllUsers,
  checkNewGamesForUser,
  syncPendingGamesForUser,
};
