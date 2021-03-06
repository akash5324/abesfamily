var Club = require('../models/clubs');
var User = require('../models/user');
var Group = require('../models/group');
var Message = require('../models/message');
var passport = require('passport');
var async = require('async');
var _ = require('underscore');
var AWS = require('aws-sdk');


var ObjectId = require('mongodb').ObjectID;

const {validate} = require('../config/validation');

var {Users} = require('../config/users');

var clients = new Users();

module.exports = (app, io, mongoose) => {
    
    app.get('/', (req, res) => {
        var errors = req.flash('error');
        var success = req.flash('success');

        if(req.session.cookie.originalMaxAge !== null){
            res.redirect('/home');
        }else{
            res.render('index', {title: 'ABES-FAMILY', messages: errors, hasErrors: errors.length > 0, 
                                success:success, noErrors:success.length > 0});
        }
    });

    app.post('/', loginValidation, passport.authenticate('local.login', {
        failureRedirect: '/',
        failureFlash : true
    }), (req, res) => {
        if(req.body.rememberme){
            req.session.cookie.maxAge = 30*24*60*60*1000; // 30 days
        }else{
            req.session.cookie.expires = null;
        }
        res.redirect('/home');
    });
    
    app.get('/signup', (req, res) => {
        Club.find({}, (err, result) => {
            var errors = req.flash('error');
            
            res.render('signup', {title: 'ABES-FAMILY | Sign Up', data:result, errors: errors, hasErrors: errors.length > 0});
        }).sort({'name': 1});
    });

    app.post('/signup', validate,  passport.authenticate('local.signup', {
        successRedirect: '/home',
        failureRedirect: '/signup',
        failureFlash: true
    }), (req, res) => {
        //res.redirect('/home');
    });
    
    app.get('/home', isLoggedIn, (req, res) => {
        async.parallel([
            function(callback){
                Club.find({}, (err, result) => {
                    callback(err, result);
                }).sort({'name': 1});
            },
            
            function(callback){
                Club.aggregate(
                {
                    $group: {
                        _id: "$country",
                    }
                },function(err, newResult){
                    callback(err, newResult);
                });
            },

            function(callback){
                Message.aggregate(
                {$match:{$or:[{"authorName":req.user.username}, {"receiverName":req.user.username}]}},
                {$sort:{'createdAt':-1}},
                {
                    $group:{"_id":{
                    "last_message_between":{
                        $cond:[
                            {
                                $lt:[
                                {$substr:["$authorName",0,1]},
                                {$substr:["$receiverName",0,1]}]
                            },
                            {$concat:["$authorName"," and ","$receiverName"]},
                            {$concat:["$receiverName"," and ","$authorName"]}
                        ]
                    }
                    },"body":{$first:"$$ROOT"}
                    }
                },function(err, newResult){
                    var opts = [
                      { path: 'body.author', model: 'User' },
                      { path: 'body.receiver', model: 'User' }
                    ];

                    Message.populate(newResult, opts, function (err, newResult1) {
                        callback(err, newResult1);
                    });
                });
            },
            
            function(callback){
                User.findOne({'username':req.user.username})
                    .populate('request.userId')
                    .exec((err, result) => {
                        callback(err, result);
                    });
            },

        ], (err, results) => {
            var res1 = results[0];
            var res2 = results[1];
            var res3 = results[2];
            var res4 = results[3];
            
            var countrySort =  _.sortBy( res2, '_id' );
            
            var productChunks = [];
            var chunkSize = 3;
            for(var i=0; i < res1.length; i += chunkSize){
                productChunks.push(res1.slice(i, i+chunkSize));
            }
            
            Message.find({'$or': [{"authorName":req.user.username}, {"receiverName":req.user.username}]})
                .populate('author')
                .populate('receiver')
                .exec((err, result3) => {
                    res.render('home', {title: 'ABES-FAMILY | Chat With Friends', user:req.user, userData:res4, data:productChunks, country:countrySort, chat:res3, image: result3});
                });
        });
    });
    
    app.post('/home', (req, res) => {
        PostRequest(req, res, '/home');

        async.parallel([
            function(callback){
                User.update({
                   '_id': req.user._id,
                   'favClub.favClubName': {$ne: req.body.clubName}
                },
                {
                   $push: {favClub: {
                       favClubName: req.body.clubName
                   }}
                }, (err, res1) => {
                   callback(err, res1);
                });
            },

            function(callback){
                Club.update({
                   '_id': req.body.id,
                   'fans.username': {$ne: req.user.username}
                },
                {
                   $push: {fans: {
                       username: req.user.username,
                       email: req.user.email
                   }}
                }, (err, res2) => {
                   callback(err, res2);
                });
            }
        ], (err, results) => {
            res.redirect('/home');
        });
    });
    
    app.get('/group/:username/:name', isLoggedIn, (req, res, next) => {
        var nameParams = req.params.name.replace(/-/g," ");
        
        
        if (req.query.search) {
           const regex = new RegExp(escapeRegex(req.query.search), 'gi');
            
            async.series({
                one: function(callback) {
                    Club.findOne({ "name": regex }, function(err, result1) {
                       if(err) {
                           return next(err);
                       } else {
                           callback(err, result1);
                       }
                    }); 
                },
                two: function(callback){
                    User.findOne({ "username": regex }, function(err, result2) {
                       if(err) {
                           return next(err);
                       } else {
                          callback(err, result2);
                       }
                    }); 
                }
            }, function(err, results) {
                var data = results.one;
                var data2 = results.two;
                
                if(data){
                    var resultData = data.name.replace(/ /g, "-")
                    res.redirect('/group/'+req.params.username+'/'+resultData);
                    
                }else if(data2){
                    var val1 = data2.username;
                    var val2 = req.user.username;
                    var value = '@'+val1+'@'+val2;
                    res.redirect('/chat/'+value);
                }else{
                    res.redirect('/group/'+req.params.username+'/'+req.params.name);
                }
                
            });
            
        }else{
            
            async.parallel([
                function(callback){
                    Message.aggregate(
                    {$match:{$or:[{"authorName":req.user.username}, {"receiverName":req.user.username}]}},
                    {$sort:{'createdAt':-1}},
                    {
                        $group:{"_id":{
                        "last_message_between":{
                            $cond:[
                                {
                                    $lt:[
                                    {$substr:["$authorName",0,1]},
                                    {$substr:["$receiverName",0,1]}]
                                },
                                {$concat:["$authorName"," and ","$receiverName"]},
                                {$concat:["$receiverName"," and ","$authorName"]}
                            ]
                        }
                        },"body":{$first:"$$ROOT"}
                        }
                    },function(err, newResult){
                        var opts = [
                          { path: 'body.author', model: 'User' },
                          { path: 'body.receiver', model: 'User' }
                        ];

                        Message.populate(newResult, opts, function (err, newResult1) {
                            callback(err, newResult1);
                        });
                    });
                },
                
                function(callback){
                    User.findOne({'username':req.user.username})
                        .populate('request.userId')
                        .populate('friendsList.friendId')
                        .exec((err, result) => {
                            callback(err, result);
                        });
                },
                
                function(callback){
                    Club.findOne({"name": nameParams}, (err, clubResult) => {
                        callback(err, clubResult);
                    });
                },
                
                function(callback){
                    Group.find({})
                        .populate('sender')
                        .exec((err, msgResult) => {
                            callback(err, msgResult);
                        });
                },
                
//                       
            ], (err, results) => {
                var res1 = results[0];
                var res2 = results[1];
                var res3 = results[2];
                var res4 = results[3];
                
                
                Message.find({'$or': [{"authorName":req.user.username}, {"receiverName":req.user.username}]})
                    .populate('author')
                    .populate('receiver')
                    .exec((err, result3) => {
                        res.render('group', {title: nameParams+' | ABES-FAMILY', user:req.user, chat:res1, data:res2, name: nameParams, club: res3, groupMsg: res4, image:result3 });
                    });
            });
        }
    });
    
    app.post('/group/:username/:name', (req, res) => {
        var nameParams = req.params.name;
        
        async.parallel([
            function(callback){
               if(req.body.message){
                   
                   var group = new Group();
                   group.sender = req.user._id;
                   group.body = req.body.message;
                   group.groupId = req.body.clubId;
                   group.createdAt = new Date();
                   group.save((err, msg) => {
                       callback(err, group);
                   })
               }
           }
        ], (err, result) => {
            res.redirect('/group/'+req.params.username+'/'+req.params.name);
        });
        
        async.parallel([
           function(callback){
               if(req.body.receiverName){
                   User.update({
                       'username': req.body.receiverName,
                       'request.userId': {$ne: req.user._id},
                       'friendsList.friendId': {$ne: req.user._id}
                   },
                   {
                       $push: {request: {
                           userId: req.user._id,
                           username: req.user.username
                       }},
                       $inc: {totalRequest: 1},
                   }, (err, count) => {
                       callback(err, count);
                   })
               };
           },

           function(callback){
                if(req.body.receiverName){
                   User.update({
                       'username': req.user.username,
                       'sentRequest.username': {$ne: req.body.receiverName}
                       // 'friendsList.friendId': {$ne: req.user._id}
                   },
                   {
                       $push: {sentRequest: {
                           username: req.body.receiverName
                       }}
                   }, (err, count) => {
                       callback(err, count);
                   });
               }
           },
            
           
            
        ], (err, results) => {
            // res.redirect('/group/'+req.params.name);
            res.redirect('/group/'+req.params.username+'/'+req.params.name);
        });
        
        async.parallel([
            function(callback){
                if(req.body.senderId){
                    //This function is used to update the document of the receiver of the friend request
                    User.update({
                       '_id': req.user._id,
                       'friendsList.friendId': {$ne: req.body.senderId}
                    },
                    {
                       $push: {friendsList: {
                           friendId: req.body.senderId,
                           friendName: req.body.senderName
                       }},
                       $pull: {request: {
                            userId: req.body.senderId,
                            username: req.body.senderName
                        }},
                        $inc: {totalRequest: -1},
                    }, (err, count) => {
                       callback(err, count);
                    });
                }
            },
            
            //This function is used to update the document of the sender of the 
            //friend request
            function(callback){
                if(req.body.senderId){
                    User.update({
                       '_id': req.body.senderId,
                       'friendsList.friendId': {$ne: req.user._id}
                    },
                    {
                       $push: {friendsList: {
                           friendId: req.user._id,
                           friendName: req.user.username
                       }},
                       $pull: {sentRequest: {
                            username: req.user.username
                        }}
                    }, (err, count) => {
                       callback(err, count);
                    });
                }
            },
            
            function(callback){
                if(req.body.user_Id){
                    User.update({
                       '_id': req.user._id,
                       'request.userId': {$eq: req.body.user_Id}
                    },
                    {
                       $pull: {request: {
                            userId: req.body.user_Id,
                        }},
                        $inc: {totalRequest: -1}
                    }, (err, count) => {
                        callback(err, count);
                    });
                }
            },

            //This is used to update the sentRequest array for the sender of the friend request
            function(callback){
                if(req.body.user_Id){
                    User.update({
                       '_id': req.body.user_Id,
                       'sentRequest.username': {$eq: req.user.username}
                    },
                    {
                       $pull: {sentRequest: {
                            username: req.user.username
                        }}
                    }, (err, count) => {
                        callback(err, count);
                    });
                }
            },

            function(callback){
                if(req.body.chatId){
                    Message.update({
                        '_id': req.body.chatId
                    },
                    {
                        "isRead": true
                    }, (err, done) => {
                        callback(err, done);
                    });
                }
            },
            
            
        ], (err, results) => {
            res.redirect('/group/'+req.params.username+'/'+req.params.name);
        });
        
        
    });
    
    
    app.get('/results', isLoggedIn, (req, res) => {
        res.redirect('/home');
    });
    
    app.post('/results', (req, res) => {
        var regex = new RegExp((req.body.country), 'gi');
        
        async.parallel([
            function(callback){
                Club.find({"$or": [{'country':regex}, {'name':regex}]}, (err, result) => {
                    callback(err, result);
                });
            },
            
            function(callback){
                Club.aggregate(
                {
                    $group: {
                        _id: "$country",
                    }
                },function(err, newResult){
                    callback(err, newResult);
                })
            }
        ], (err, results) => {
            var res1 = results[0];
            var res2 = results[1];

            var productChunks = [];
            var chunkSize = 3;
            for(var i=0; i < res1.length; i += chunkSize){
                productChunks.push(res1.slice(i, i+chunkSize));
            }
            
            res.render('results', {title: 'Soccerkik | Chat With Friends', user:req.user, data:productChunks, country:res2, chat: ''});
            //res.redirect('/results')
        });
    });
    
    app.get('/members', isLoggedIn, (req, res) => {
        var regex = new RegExp(req.body.country, 'gi');
        
        async.parallel([
            function(callback){
                User.find({}, (err, result) => {
                    callback(err, result);
                });
            },

            function(callback){
                Message.aggregate(
                {$match:{$or:[{"authorName":req.user.username}, {"receiverName":req.user.username}]}},
                {$sort:{'createdAt':-1}},
                {
                    $group:{"_id":{
                    "last_message_between":{
                        $cond:[
                            {
                                $lt:[
                                {$substr:["$authorName",0,1]},
                                {$substr:["$receiverName",0,1]}]
                            },
                            {$concat:["$authorName"," and ","$receiverName"]},
                            {$concat:["$receiverName"," and ","$authorName"]}
                        ]
                    }
                    },"body":{$first:"$$ROOT"}
                    }
                },function(err, newResult){
                    var opts = [
                      { path: 'body.author', model: 'User' },
                      { path: 'body.receiver', model: 'User' }
                    ];

                    Message.populate(newResult, opts, function (err, newResult1) {
                        callback(err, newResult1);
                    });
                });
            },

            function(callback){
                Club.find({}, (err, clubresult) => {
                    callback(err, clubresult);
                }).sort({'name': 1});
            },
            
            function(callback){
                User.findOne({'username':req.user.username})
                    .populate('request.userId')
                    .exec((err, result) => {
                        callback(err, result);
                    });
            },

        ], (err, results) => {
            var res1 = results[0];
            var res2 = results[1];
            var res3 = results[2];
            var res4 = results[3];

            var memberChunks = [];
            var chunkSize = 3;
            for(var i=0; i < res1.length; i += chunkSize){
                memberChunks.push(res1.slice(i, i+chunkSize));
            }

            Message.find({'$or': [{"authorName":req.user.username}, {"receiverName":req.user.username}]})
                .populate('author')
                .populate('receiver')
                .exec((err, result3) => {
                    res.render('members', {title: 'Soccerkik | Members', user:req.user, userData: res4, data:memberChunks, chat:res2, clubs:res3, image: result3});
                });
        });
    });
    
    app.post('/members', (req, res) => {
        var regex1 = new RegExp(escapeRegex(req.body.gender), 'gi');
        var regex2 = new RegExp(escapeRegex(req.body.club), 'gi');
        
        User.find({"$or": [{'gender':req.body.gender}, {'club':req.body.club}]}, (err, result) => {
            var members = [];
            var chunkSize = 3;
            for(var i=0; i < result.length; i += chunkSize){
                members.push(result.slice(i, i+chunkSize));
            }

            res.render('members', {title: 'Soccerkik | Members', user:req.user, data:members, chat:'', clubs: '', image: ''});
        });

        PostRequest(req, res, '/members');
    });
    
    app.get('/football/latest-news', isLoggedIn, (req, res) => {
        res.render('football_news', {title: "Soccerkik - Latest Football News", user: req.user});
    });
    
    app.get('/logout', (req, res) => {
        req.logout();
        req.session.destroy((err) => {
            res.redirect('/');
        });
    });
};


function loginValidation(req, res, next){
   req.checkBody('email', 'Email is Required').notEmpty();
   req.checkBody('email', 'Email is Invalid').isEmail();
   req.checkBody('password', 'Password is Required').notEmpty();
   req.checkBody('password', 'Password Must Not Be Less Than 5 Characters').isLength({min:5});

    req.getValidationResult()
        .then((result) => {
            const errors = result.array();
            const messages = [];
            errors.forEach((error) => {
                messages.push(error.msg);
            });

            req.flash('error', messages);
            res.redirect('/');
        })
        .catch((err) => {
            return next();
        })
}

function isLoggedIn(req, res, next){
    if(req.isAuthenticated()){
        next();
    }else{
		res.redirect('/');
	}
}

//Fussy search mongodb
function escapeRegex(text) {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

function PostRequest(req, res, link){
    async.parallel([
        function(callback){
            if(req.body.senderId){
                //This function is used to update the document of the receiver of the friend request
                User.update({
                   '_id': req.user._id,
                   'friendsList.friendId': {$ne: req.body.senderId}
                },
                {
                   $push: {friendsList: {
                       friendId: req.body.senderId,
                       friendName: req.body.senderName
                   }},
                   $pull: {request: {
                        userId: req.body.senderId,
                        username: req.body.senderName
                    }},
                    $inc: {totalRequest: -1},
                }, (err, count) => {
                   callback(err, count);
                });
            }
        },
        
        //This function is used to update the document of the sender of the 
        //friend request
        function(callback){
            if(req.body.senderId){
                User.update({
                   '_id': req.body.senderId,
                   'friendsList.friendId': {$ne: req.user._id}
                },
                {
                   $push: {friendsList: {
                       friendId: req.user._id,
                       friendName: req.user.username
                   }},
                   $pull: {sentRequest: {
                        username: req.user.username
                    }}
                }, (err, count) => {
                   callback(err, count);
                });
            }
        },
        
        function(callback){
            if(req.body.user_Id){
                User.update({
                   '_id': req.user._id,
                   'request.userId': {$eq: req.body.user_Id}
                },
                {
                   $pull: {request: {
                        userId: req.body.user_Id,
                    }},
                    $inc: {totalRequest: -1}
                }, (err, count) => {
                    callback(err, count);
                });
            }
        },

        //This is used to update the sentRequest array for the sender of the friend request
        function(callback){
            if(req.body.user_Id){
                User.update({
                   '_id': req.body.user_Id,
                   'sentRequest.username': {$eq: req.user.username}
                },
                {
                   $pull: {sentRequest: {
                        username: req.user.username
                    }}
                }, (err, count) => {
                    callback(err, count);
                });
            }
        },

        function(callback){
            if(req.body.chatId){
                Message.update({
                    '_id': req.body.chatId
                },
                {
                    "isRead": true
                }, (err, done) => {
                    callback(err, done);
                });
            }
        }
    ], (err, results) => {
        res.redirect(link);
    });
}
