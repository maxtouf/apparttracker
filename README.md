# AppartTracker - Application de Suivi d'Achat Immobilier

## 📋 Description

AppartTracker est une application web moderne conçue pour simplifier et organiser le processus d'achat immobilier. Elle permet aux utilisateurs de suivre l'avancement de leurs projets d'acquisition d'appartements, de gérer les documents, de planifier les rendez-vous et de visualiser leur progression en temps réel.

## ✨ Fonctionnalités Principales

### 🏠 Gestion des Biens
- Ajout et suivi de multiples propriétés
- Informations détaillées (adresse, prix, surface, etc.)
- Statuts de progression (recherche, visite, négociation, compromis, acte)
- Calcul automatique de la progression globale

### 📋 Suivi des Étapes
- Étapes prédéfinies pour chaque phase d'achat
- Gestion des priorités et des échéances
- Notifications pour les tâches en retard
- Historique complet des actions

### 📄 Gestion Documentaire
- Upload et organisation des documents
- Catégorisation automatique
- Prévisualisation des fichiers
- Partage sécurisé entre utilisateurs
- Contrôle des versions

### 📅 Calendrier Intégré
- Planification des rendez-vous
- Rappels automatiques
- Synchronisation avec les étapes
- Vue mensuelle et hebdomadaire

### 📊 Tableau de Bord
- Vue d'ensemble de tous les projets
- Statistiques en temps réel
- Graphiques de progression
- Alertes et notifications

## 🛠️ Technologies Utilisées

### Backend
- **Node.js** - Runtime JavaScript
- **Express.js** - Framework web
- **MongoDB** - Base de données NoSQL
- **Mongoose** - ODM pour MongoDB
- **JWT** - Authentification
- **Multer** - Gestion des fichiers
- **Express Validator** - Validation des données
- **Bcrypt** - Hachage des mots de passe
- **Cors** - Gestion CORS
- **Helmet** - Sécurité HTTP

### Frontend
- **React 18** - Bibliothèque UI
- **React Router** - Routage
- **React Query** - Gestion d'état serveur
- **React Hook Form** - Gestion des formulaires
- **Yup** - Validation des schémas
- **Zustand** - Gestion d'état client
- **Tailwind CSS** - Framework CSS
- **Framer Motion** - Animations
- **Heroicons** - Icônes
- **Chart.js** - Graphiques
- **React Hot Toast** - Notifications
- **Axios** - Client HTTP

## 🚀 Installation et Configuration

### Prérequis
- Node.js (version 16 ou supérieure)
- MongoDB (local ou cloud)
- npm ou yarn

### Installation

1. **Cloner le repository**
```bash
git clone https://github.com/maxtouf/apparttracker.git
cd apparttracker
```

2. **Configuration du Backend**
```bash
cd backend
npm install
```

3. **Configuration des variables d'environnement**
```bash
cp .env.example .env
```

Modifiez le fichier `.env` avec vos configurations :
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/apparttracker
JWT_SECRET=votre_secret_jwt_tres_securise
JWT_EXPIRE=7d
UPLOAD_PATH=./uploads
MAX_FILE_SIZE=10485760
NODE_ENV=development
```

4. **Configuration du Frontend**
```bash
cd ../frontend
npm install
```

### Démarrage

1. **Démarrer le backend**
```bash
cd backend
npm run dev
```
Le serveur sera accessible sur `http://localhost:5000`

2. **Démarrer le frontend**
```bash
cd frontend
npm start
```
L'application sera accessible sur `http://localhost:3000`

## 📁 Structure du Projet

```
apparttracker/
├── backend/
│   ├── middleware/          # Middlewares (auth, validation)
│   ├── models/             # Modèles Mongoose
│   ├── routes/             # Routes API
│   ├── uploads/            # Fichiers uploadés
│   ├── .env.example        # Variables d'environnement exemple
│   ├── package.json        # Dépendances backend
│   └── server.js           # Point d'entrée serveur
├── frontend/
│   ├── public/             # Fichiers statiques
│   ├── src/
│   │   ├── components/     # Composants réutilisables
│   │   ├── layouts/        # Layouts de l'application
│   │   ├── pages/          # Pages de l'application
│   │   ├── stores/         # Gestion d'état (Zustand)
│   │   ├── App.js          # Composant principal
│   │   └── index.js        # Point d'entrée React
│   ├── package.json        # Dépendances frontend
│   └── tailwind.config.js  # Configuration Tailwind
└── README.md               # Documentation
```

## 🔐 Authentification

L'application utilise JWT (JSON Web Tokens) pour l'authentification :
- Inscription avec validation des données
- Connexion sécurisée
- Gestion des sessions
- Protection des routes
- Gestion des rôles et permissions

## 📱 Interface Utilisateur

### Design System
- **Couleurs** : Palette moderne avec bleu primaire
- **Typographie** : Inter et Lexend pour une lisibilité optimale
- **Composants** : Design system cohérent avec Tailwind CSS
- **Responsive** : Adaptation mobile-first
- **Animations** : Transitions fluides avec Framer Motion

### Pages Principales
- **Dashboard** : Vue d'ensemble et statistiques
- **Propriétés** : Gestion des biens immobiliers
- **Étapes** : Suivi des tâches et processus
- **Documents** : Gestion documentaire
- **Calendrier** : Planning et rendez-vous
- **Profil** : Gestion du compte utilisateur

## 🔒 Sécurité

- Hachage des mots de passe avec bcrypt
- Validation stricte des entrées
- Protection CSRF
- Headers de sécurité avec Helmet
- Limitation du taux de requêtes
- Validation des fichiers uploadés
- Gestion sécurisée des tokens JWT

## 📊 API Endpoints

### Authentification
- `POST /api/auth/register` - Inscription
- `POST /api/auth/login` - Connexion
- `GET /api/auth/profile` - Profil utilisateur
- `PUT /api/auth/profile` - Mise à jour profil

### Propriétés
- `GET /api/properties` - Liste des propriétés
- `POST /api/properties` - Créer une propriété
- `GET /api/properties/:id` - Détails d'une propriété
- `PUT /api/properties/:id` - Modifier une propriété
- `DELETE /api/properties/:id` - Supprimer une propriété

### Étapes
- `GET /api/steps` - Liste des étapes
- `POST /api/steps` - Créer une étape
- `PUT /api/steps/:id` - Modifier une étape
- `DELETE /api/steps/:id` - Supprimer une étape

### Documents
- `GET /api/documents` - Liste des documents
- `POST /api/documents/upload` - Upload de document
- `GET /api/documents/:id/download` - Télécharger un document
- `DELETE /api/documents/:id` - Supprimer un document

### Calendrier
- `GET /api/calendar/events` - Liste des événements
- `POST /api/calendar/events` - Créer un événement
- `PUT /api/calendar/events/:id` - Modifier un événement
- `DELETE /api/calendar/events/:id` - Supprimer un événement

### Dashboard
- `GET /api/dashboard/overview` - Vue d'ensemble
- `GET /api/dashboard/analytics` - Analyses avancées
- `GET /api/dashboard/activity` - Activité récente

## 🧪 Tests

```bash
# Tests frontend
cd frontend
npm test

# Tests backend (à implémenter)
cd backend
npm test
```

## 🚀 Déploiement

### Production

1. **Build du frontend**
```bash
cd frontend
npm run build
```

2. **Configuration production**
- Modifier les variables d'environnement
- Configurer la base de données de production
- Configurer le serveur web (nginx, Apache)

3. **Démarrage en production**
```bash
cd backend
npm start
```

## 🤝 Contribution

1. Fork le projet
2. Créer une branche feature (`git checkout -b feature/AmazingFeature`)
3. Commit les changements (`git commit -m 'Add some AmazingFeature'`)
4. Push vers la branche (`git push origin feature/AmazingFeature`)
5. Ouvrir une Pull Request

## 📝 Licence

Ce projet est sous licence MIT. Voir le fichier `LICENSE` pour plus de détails.

## 📞 Support

Pour toute question ou problème :
- Ouvrir une issue sur GitHub
- Contacter l'équipe de développement

## 🔄 Roadmap

### Version 1.1
- [ ] Notifications push
- [ ] Export PDF des rapports
- [ ] Intégration calendrier externe
- [ ] Mode hors ligne

### Version 1.2
- [ ] Application mobile
- [ ] Intégration bancaire
- [ ] IA pour recommandations
- [ ] Collaboration multi-utilisateurs

---

**AppartTracker** - Simplifiez votre parcours d'achat immobilier 🏠✨