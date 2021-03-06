package io.lumify.web.auth.usernameonly.routes;

import io.lumify.miniweb.HandlerChain;
import io.lumify.miniweb.utils.UrlUtils;
import com.google.inject.Inject;
import io.lumify.core.config.Configuration;
import io.lumify.core.model.user.UserRepository;
import io.lumify.core.model.workspace.WorkspaceRepository;
import io.lumify.core.user.User;
import io.lumify.web.BaseRequestHandler;
import io.lumify.web.CurrentUser;
import org.json.JSONObject;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.math.BigInteger;
import java.security.SecureRandom;

public class Login extends BaseRequestHandler {
    @Inject
    public Login(UserRepository userRepository, WorkspaceRepository workspaceRepository, Configuration configuration) {
        super(userRepository, workspaceRepository, configuration);
    }

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response, HandlerChain chain) throws Exception {
        final String username = UrlUtils.urlDecode(request.getParameter("username"));

        User user = getUserRepository().findByUsername(username);
        if (user == null) {
            // For form based authentication, username and displayName will be the same
            String randomPassword = new BigInteger(120, new SecureRandom()).toString(32);
            user = getUserRepository().addUser(username, username, null, randomPassword, new String[0]);
        }
        getUserRepository().recordLogin(user, request.getRemoteAddr());

        CurrentUser.set(request, user.getUserId(), user.getUsername());
        JSONObject json = new JSONObject();
        json.put("status", "OK");
        respondWithJson(response, json);
    }
}
